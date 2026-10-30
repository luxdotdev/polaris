/**
 * Secret Requests over IPC (ADR 0089, ENG-605): the value crosses IPC once, renderer to main,
 * as a plain string; main wraps it in `Redacted` for `secret.provide` and never stores or logs
 * it. The renderer imports this for types only.
 */
import { RequestId, SessionId } from "@polaris/protocol";
import { Schema } from "effect";

const HostKey = Schema.String.check(Schema.isMinLength(1));

export const SecretRequestInputs = {
  /** Answers a Secret Request with its value; a decline is the ordinary `RespondToApproval` Deny. */
  "secret.provide": Schema.Struct({
    hostKey: HostKey,
    sessionId: SessionId,
    requestId: RequestId,
    // A plain string: a checked schema's failure would quote the value in its message.
    value: Schema.String,
  }),
} as const;

export interface SecretRequestOutputs {
  readonly "secret.provide": null;
}
