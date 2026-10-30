/**
 * Secret Requests (ADR 0089, ENG-605): an agent asks the user for a value kept
 * out of the conversation and the event log. The request is an approval of kind
 * `secret`; its value travels only on `secret.provide`, and is never recorded.
 */
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { RequestId, SessionId } from "./ids.ts";
import { NotFound } from "./errors.ts";

/** The longest value a Secret Request takes, in UTF-8 bytes. */
export const SECRET_MAX_BYTES = 16 * 1024;

/** How long an agent may wait for an answer: 10 minutes unless it asks, at most an hour. */
export const SECRET_REQUEST_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export const SECRET_REQUEST_MAX_TIMEOUT_MS = 60 * 60 * 1000;

/** How long a provided secret stays readable. */
export const SECRET_TTL_MS = 24 * 60 * 60 * 1000;

const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

/** One trimmed line, not empty, at most `SECRET_MAX_BYTES`. */
export const SecretValue = Schema.Trimmed.check(
  Schema.makeFilter((value: string) => value.length > 0 || "Enter the secret"),
  Schema.makeFilter((value: string) => !/[\r\n]/.test(value) || "Use a single line"),
  Schema.makeFilter(
    (value: string) => byteLength(value) <= SECRET_MAX_BYTES || "The secret is too long"
  )
);

export const SecretRejectedReason = Schema.Literals([
  /** The request was answered, withdrawn or timed out: nothing was saved. */
  "ended",
  /** The request isn't a Secret Request. */
  "not-secret",
  /** The Host couldn't write the file. */
  "storage",
]);

export type SecretRejectedReason = typeof SecretRejectedReason.Type;

export class SecretRejected extends Schema.TaggedError<SecretRejected>()("SecretRejected", {
  reason: SecretRejectedReason,
  /** What the user reads. */
  message: Schema.String,
}) {}

/** Saves the value on the Host and answers the request `Provided`; `RespondToApproval` declines. */
export const ProvideSecret = Rpc.make("secret.provide", {
  payload: {
    sessionId: SessionId,
    requestId: RequestId,
    value: Schema.RedactedFromValue(SecretValue),
  },
  error: Schema.Union([SecretRejected, NotFound]),
});

export class SecretRpcs extends RpcGroup.make(ProvideSecret) {}
