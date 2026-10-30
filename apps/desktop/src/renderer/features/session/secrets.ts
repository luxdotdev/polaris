/**
 * Answering a Secret Request (ADR 0089): the value goes to main once, on `secret.provide`, and is
 * kept nowhere here. Nothing about the call is logged; only the refusal's words come back.
 */
import type { RequestId, SessionId } from "@polaris/protocol";
import { polaris } from "../bridge.ts";
import { provideFailure, SECRET_SAVE_FAILED, secretDraft } from "./model/secret.ts";

export interface SecretTarget {
  readonly hostKey: string;
  readonly sessionId: SessionId;
  readonly requestId: RequestId;
}

/** Sends the trimmed value; null once the Host saved it, else what the user reads. */
export const provideSecret = async (
  target: SecretTarget,
  typed: string
): Promise<string | null> => {
  const draft = secretDraft(typed);

  if (!draft.ok) return draft.problem ?? "Enter the secret";

  try {
    const result = await polaris().request("secret.provide", { ...target, value: draft.value });

    return result.ok ? null : provideFailure(result.error);
  } catch {
    // The bridge itself failed; its error is never shown or logged, as it may quote the input.
    return SECRET_SAVE_FAILED;
  }
};
