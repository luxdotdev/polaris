import { Schema } from "effect";
import { LanguageEditSnapshot } from "@polaris/protocol";
import { HostDocument, HostAcknowledgedBuffer, requireActive } from "./contracts.ts";
import type { HostDelivery, PreparationPort } from "./contracts.ts";

/** A Host mirror has no Client draft revision; only independent authenticated acknowledgment may supply it. */
export const acknowledgedDocument = async (
  port: PreparationPort,
  delivery: HostDelivery,
  uri: string,
  signal: AbortSignal
) => {
  requireActive(signal);
  const raw = await port.document(uri, delivery);
  const document = raw === null ? null : Schema.decodeUnknownSync(HostDocument)(raw);
  const fence = delivery.fence.documents.find((entry) => entry.uri === uri);

  if (
    (document === null) !== (fence === undefined) ||
    (document !== null && document.version !== fence?.version)
  )
    throw new Error("Host synchronized document differs from captured fence.");

  if (document === null) return { document, buffer: null };
  const supplied = await port.acknowledgedBuffer?.(uri, delivery, document, signal);
  requireActive(signal);

  if (supplied === null || supplied === undefined)
    throw new Error("Authenticated Client buffer acknowledgment is unavailable.");

  const acknowledgment = Schema.decodeUnknownSync(HostAcknowledgedBuffer)(supplied);
  const buffer = Schema.decodeUnknownSync(LanguageEditSnapshot.fields.buffer)(acknowledgment);

  if (
    buffer === null ||
    acknowledgment.uri !== uri ||
    buffer.version !== document.version ||
    buffer.text !== document.text
  )
    throw new Error("Authenticated buffer acknowledgment differs from Host document.");

  return { document, buffer };
};
