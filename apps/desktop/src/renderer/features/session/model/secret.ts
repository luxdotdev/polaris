/**
 * A Secret Request (ADR 0089) as the Desktop App shows it: never approved, only answered with a
 * value on `secret.provide` or declined. Pure, so it is tested.
 */
import { type ApprovalRequest, SECRET_MAX_BYTES } from "@polaris/protocol";
import type { IpcError } from "../../../../shared/api.ts";
import type { SecretOutcome } from "../../../store/sessionModel.ts";

export const isSecretRequest = (request: Pick<ApprovalRequest, "kind">) =>
  request.kind === "secret";

export type { SecretOutcome } from "../../../store/sessionModel.ts";

export const SECRET_OUTCOME_TEXT: Readonly<Record<SecretOutcome, string>> = {
  provided: "Saved securely and kept private",
  declined: "Declined",
  ended: "Request ended",
};

export const DEFAULT_SECRET_PLACEHOLDER = "Paste the secret";

export const secretPlaceholder = (request: Pick<ApprovalRequest, "placeholder">) =>
  request.placeholder == null || request.placeholder.trim() === ""
    ? DEFAULT_SECRET_PLACEHOLDER
    : request.placeholder;

export const SECRET_FOOTER =
  "Kept out of chat, in a private file this agent's commands can read for 24 hours";

const bytes = (value: string) => new TextEncoder().encode(value).byteLength;

/** What the typed value would send: trimmed, or why it can't be sent (null message: empty). */
export type SecretDraft =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly problem: string | null };

export const secretDraft = (typed: string): SecretDraft => {
  const value = typed.trim();

  if (value === "") return { ok: false, problem: null };

  if (/[\r\n]/.test(value)) return { ok: false, problem: "Use a single line" };

  if (bytes(value) > SECRET_MAX_BYTES) return { ok: false, problem: "The secret is too long" };

  return { ok: true, value };
};

export const SECRET_SAVE_FAILED = "Couldn't save the secret. Try again.";

/** The Host's own words for a refusal it understood; anything else (transport) is generic. */
export const provideFailure = (error: IpcError): string => {
  if (error.code === "NotFound") return "This request has ended, so the secret wasn't saved.";

  return error.code === "SecretRejected" && error.message.trim() !== ""
    ? error.message
    : SECRET_SAVE_FAILED;
};

/** "8m left": the quiet countdown to an unanswered request's timeout; null once due or unset. */
export const secretTimeLeft = (expiresAt: string | null | undefined, now: number) => {
  if (expiresAt == null) return null;
  const ms = Date.parse(expiresAt) - now;

  if (!(ms > 0)) return null;

  return ms < 60_000 ? "under a minute left" : `${Math.ceil(ms / 60_000)}m left`;
};

/** "Claude Code is asking for a secret": every summary of a Secret Request. */
export const askingForSecret = (who: string) => `${who} is asking for a secret`;

/** A session row's or inbox card's line for a Secret Request: the label only, never the reason. */
export const secretLine = (label: string) => `Asking for a secret · ${label}`;
