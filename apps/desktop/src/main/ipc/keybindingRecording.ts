/** While recording, native menu roles must let the renderer reject reserved keys. */
import { Option, Schema } from "effect";
import type { WebFrameMain } from "electron";

const decode = Schema.decodeUnknownOption(Schema.Boolean);

interface Sender {
  readonly setIgnoreMenuShortcuts: (active: boolean) => void;
  readonly isDestroyed: () => boolean;
  readonly on: (
    name: "did-start-navigation",
    listener: (details: { readonly isMainFrame: boolean; readonly isSameDocument: boolean }) => void
  ) => void;
}

export interface RecordingOrigin {
  readonly senderFrame: Pick<WebFrameMain, "url"> | null;
  readonly sender: Sender;
}

export const keybindingRecording = (trusted: (url: string) => boolean) => {
  const watched = new WeakSet<Sender>();

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Native IPC payloads must be decoded before affecting menu shortcuts.
  return (event: RecordingOrigin, value: unknown): boolean => {
    if (event.senderFrame === null || !trusted(event.senderFrame.url)) return false;
    const active = decode(value);

    if (Option.isNone(active)) return false;
    const sender = event.sender;
    sender.setIgnoreMenuShortcuts(active.value);

    if (!watched.has(sender)) {
      watched.add(sender);
      sender.on("did-start-navigation", (details) => {
        if (details.isMainFrame && !details.isSameDocument && !sender.isDestroyed())
          sender.setIgnoreMenuShortcuts(false);
      });
    }

    return true;
  };
};
