import {
  LanguageFormatPreflight,
  LanguageFormatOutcome,
  LanguageTextEdit,
  LanguageError,
} from "@polaris/protocol";
import { Predicate, Schema } from "effect";
import type { Entry } from "./types.ts";
import type { LanguageRequestFence, LanguageJsonObject, LanguageJson } from "@polaris/protocol";
import { failure } from "../transport/framing.ts";

const Edits = Schema.NullOr(Schema.Array(LanguageTextEdit).check(Schema.isMaxLength(4096)));

function formatFailure(requestId: string, cause: unknown) {
  const error = Schema.is(LanguageError)(cause) ? cause : undefined;

  if (error?.reason === "not-owner" || error?.reason === "awaiting-trust") throw error;

  const reasons = {
    "stale-document": "stale",
    "stale-generation": "stale",
    timeout: "timeout",
    cancelled: "cancelled",
    "unsupported-capability": "unavailable",
    "not-ready": "unavailable",
  } as const;

  const reason =
    error !== undefined && Object.hasOwn(reasons, error.reason)
      ? // SAFETY: hasOwn checked the finite mapping's keys.
        reasons[error.reason as keyof typeof reasons]
      : "formatter-failed";

  return LanguageFormatOutcome.cases.Failed.make({
    requestId,
    reason,
    message: `Language formatting: ${reason}`,
  });
}

/** The provider returns edits only; the Client owns undo and any subsequent save. */
export function bindFormat(
  owned: (clientId: string, context: Entry["identity"]) => Entry,
  requestRaw: (
    clientId: string,
    requestId: string,
    fence: LanguageRequestFence,
    method: string,
    params: typeof LanguageJsonObject.Type,
    deadline: number,
    signal?: AbortSignal
  ) => Promise<typeof LanguageJson.Type>
) {
  return async (clientId: string, payload: LanguageFormatPreflight, signal?: AbortSignal) => {
    const input = Schema.decodeUnknownSync(LanguageFormatPreflight)(payload);

    const entry = owned(clientId, input.fence.context);

    if (Predicate.isTagged(input.formatter, "None"))
      return LanguageFormatOutcome.cases.Skipped.make({
        requestId: input.requestId,
        reason: "no-formatter",
      });

    if (
      !Predicate.isTagged(input.formatter, "Provider") ||
      input.formatter.providerId !== entry.identity.providerId
    )
      return formatFailure(
        input.requestId,
        failure("unsupported-capability", "Formatter unavailable")
      );

    try {
      entry.documents.fence(input.fence);

      if (entry.documents.open.get(input.document.uri)?.text !== input.snapshot)
        throw failure("stale-document", "Formatter snapshot changed");

      const result = await requestRaw(
        clientId,
        input.requestId,
        input.fence,
        "textDocument/formatting",
        { textDocument: { uri: input.document.uri }, options: input.options },
        input.deadline,
        signal
      );

      return LanguageFormatOutcome.cases.Formatted.make({
        requestId: input.requestId,
        fence: input.fence,
        document: input.document,
        edits: Schema.decodeUnknownSync(Edits)(result) ?? [],
      });
    } catch (cause) {
      return formatFailure(input.requestId, cause);
    }
  };
}
