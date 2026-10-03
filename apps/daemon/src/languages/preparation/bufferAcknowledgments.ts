import type { LanguageRequestFence } from "@polaris/protocol";
import type { HostAcknowledgedBuffer, PreparationPort } from "./contracts.ts";
import { requireActive } from "./contracts.ts";

/** Actual Host BufferAcknowledgments public read port; no Client tuple is manufactured here. */
export interface BufferAcknowledgmentReadPort {
  readonly read: (fence: LanguageRequestFence, uri: string) => HostAcknowledgedBuffer;
}

/** Resolve the current independently authenticated store from its connection/context lifetime closure. */
export const acknowledgedBufferReader =
  (
    current: () => BufferAcknowledgmentReadPort | null
  ): NonNullable<PreparationPort["acknowledgedBuffer"]> =>
  async (uri, delivery, _document, signal) => {
    requireActive(signal);
    const store = current();

    if (store === null) throw new Error("Authenticated buffer acknowledgment unavailable.");
    const buffer = store.read(delivery.fence, uri);
    requireActive(signal);

    return buffer;
  };
