/**
 * A Secret Request's value on its way to the Host (ADR 0089): trimmed, checked as the Host
 * checks it, and wrapped in `Redacted` so it never prints. Never stored, never logged.
 */
import { SecretValue } from "@polaris/protocol";
import { Redacted, Result, Schema } from "effect";

const decode = Schema.decodeUnknownResult(SecretValue);

/** The value to send, or why it can't go as typed ("Use a single line"). */
export const secretValue = (typed: string): Result.Result<Redacted.Redacted<string>, string> =>
  Result.match(decode(typed.trim()), {
    onSuccess: (value) => Result.succeed(Redacted.make(value)),
    onFailure: (error) => Result.fail(error.message),
  });

/** Save stays off until something other than spaces is typed. */
export const canSave = (typed: string): boolean => typed.trim() !== "";

/** The card's footer: where the value goes and for how long (`SECRET_TTL_MS`). */
export const SECRET_FOOTER =
  "Kept out of chat, in a private file this agent's commands can read for 24 hours";

export const SECRET_PLACEHOLDER = "Paste the secret";

/** How an ended Secret Request reads in the strip. */
export const SECRET_OUTCOMES = {
  saved: "Saved securely and kept private",
  declined: "Declined",
  ended: "Request ended",
} as const;
