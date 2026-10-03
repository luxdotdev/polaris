import * as P from "@polaris/protocol";
import { Schema } from "effect";
import type { LanguageBuffer, LanguageProvider } from "./types.ts";

/** Edit intent captures only the complete actual provider acknowledgment at request creation. */
export const captureEditIntentFence = (
  provider: LanguageProvider,
  buffer: LanguageBuffer
): P.LanguageRequestFence => {
  const ack = Schema.decodeUnknownSync(P.LanguageSyncAck)(provider.ack);
  const seen = new Set<string>();

  for (const document of ack.documents) {
    if (seen.has(document.uri)) throw new Error("Duplicate acknowledged language document.");
    seen.add(document.uri);
  }

  if (
    !ack.documents.some(
      (document) => document.uri === buffer.uri && document.version === buffer.version
    )
  )
    throw new Error("The initiating document is not acknowledged.");

  const fence = P.LanguageRequestFence.make({
    context: provider.context,
    requiredSequence: ack.acceptedSequence,
    documents: ack.documents,
  });

  if (!P.languageFenceSatisfied(fence, ack))
    throw new Error("The acknowledged provider context changed.");

  return fence;
};
