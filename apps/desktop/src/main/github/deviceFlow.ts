/**
 * The OAuth device flow's polling, as a pure step: what one answer from
 * `/login/oauth/access_token` means for the next poll (docs/research/github-review-apis.md §3).
 */
import { GITHUB_SCOPES, type SignInFailure } from "../../shared/github.ts";
import { tokenPairFrom } from "./credentials.ts";
import type { TokenPair } from "./store.ts";
import type { TokenResponse } from "./wire.ts";

export type PollStep =
  | { readonly kind: "wait"; readonly interval: number }
  | { readonly kind: "done"; readonly tokens: TokenPair; readonly scopes: ReadonlyArray<string> }
  | { readonly kind: "fail"; readonly failure: SignInFailure };

const FAILURES = new Map<string, SignInFailure>([
  ["expired_token", "expired"],
  ["access_denied", "denied"],
  ["device_flow_disabled", "disabled"],
  ["incorrect_client_credentials", "disabled"],
  ["incorrect_device_code", "expired"],
  ["unsupported_grant_type", "disabled"],
]);

/** GitHub separates granted scopes with commas (the request uses spaces). */
export const scopesOf = (scope: string | undefined) =>
  (scope ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");

export const missingScopes = (granted: ReadonlyArray<string>) =>
  GITHUB_SCOPES.filter((s) => !granted.includes(s));

/** `interval` is the current wait in seconds; `slow_down` adds 5 unless GitHub names a new one. */
export const pollStep = (response: TokenResponse, interval: number, now: number): PollStep => {
  const tokens = tokenPairFrom(response, now);

  if (tokens !== null) return { kind: "done", tokens, scopes: scopesOf(response.scope) };

  if (response.error === "authorization_pending") return { kind: "wait", interval };

  if (response.error === "slow_down")
    return { kind: "wait", interval: response.interval ?? interval + 5 };

  return { kind: "fail", failure: FAILURES.get(response.error ?? "") ?? "network" };
};
