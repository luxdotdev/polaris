/** Account Server origins (the issuer) and the PKCE secrets one sign-in uses (RFC 7636). */
import { POLARIS_CLOUD_ACCOUNTS_URL } from "@polaris/protocol";
import { Effect } from "effect";
import { Base64Url } from "effect/encoding";
import { AccountsError } from "./contract.ts";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The issuer for what the user typed: an https origin (a bare domain gets https), or http on
 * loopback for a local Account Server. A path, query or credentials are refused.
 */
export const accountServerOrigin = (input: string): Effect.Effect<string, AccountsError> => {
  const text = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;

  const refuse = (message: string) =>
    Effect.fail(new AccountsError({ reason: "invalid-server", message }));

  if (!URL.canParse(withScheme)) return refuse("not a URL");
  const url = new URL(withScheme);

  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname)))
    return refuse("an Account Server needs https");

  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "")
    return refuse("an Account Server is an origin, with nothing after it");

  if (url.pathname !== "/") return refuse("an Account Server is an origin, without a path");

  return Effect.succeed(url.origin);
};

/**
 * A device sign-in's verification URI, only on the Account Server's own origin over https (or
 * http on loopback): the app opens it in a browser, so another scheme or origin is refused.
 */
export const verificationUriOn = (
  origin: string,
  uri: string
): Effect.Effect<string, AccountsError> => {
  const refuse = Effect.fail(
    new AccountsError({
      reason: "sign-in-failed",
      message: "the Account Server sent a sign-in page that isn't its own",
    })
  );

  if (!URL.canParse(uri)) return refuse;
  const url = new URL(uri);

  const scheme =
    url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));

  if (!scheme || url.origin !== origin || url.username !== "" || url.password !== "") return refuse;

  return Effect.succeed(url.href);
};

export const isPolarisCloud = (server: string) => server === POLARIS_CLOUD_ACCOUNTS_URL;

const base64Url = (bytes: Uint8Array) => Base64Url.encode(bytes);

const randomText = (bytes: number) =>
  base64Url(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));

export interface Pkce {
  /** 43 characters of base64url, within RFC 7636's alphabet. */
  readonly verifier: string;
  /** `base64url(SHA-256(verifier))`. */
  readonly challenge: string;
  readonly state: string;
}

export const challengeOf = (verifier: string) =>
  Effect.promise(() =>
    globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  ).pipe(Effect.map((digest) => base64Url(new Uint8Array(digest))));

export const pkceSecrets: Effect.Effect<Pkce> = Effect.gen(function* () {
  const verifier = randomText(32);

  return { verifier, challenge: yield* challengeOf(verifier), state: randomText(16) };
});

/** `{server}/sign-in?…`: the page the browser opens for this sign-in. */
export const signInUrl = (server: string, redirectUri: string, pkce: Pkce) => {
  const url = new URL("/sign-in", server);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", pkce.state);
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");

  return url.toString();
};

/** A fresh Account id: lowercase hex, so it is a valid secret-store key segment. */
export const newAccountId = () =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
