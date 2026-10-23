/** One push-to-talk transcription, with bounded audio and ordered microphone cleanup. */
import type { PolarisClient, Transcript } from "@polaris/sdk";
import type { Glasses } from "../glasses/bridge.ts";
import { audioFeed } from "../voice/audio.ts";

export interface VoiceCallbacks {
  readonly heard: (transcript: Transcript) => void;
  readonly failed: (cause: unknown) => void;
}

export interface Listening {
  readonly push: (pcm: Uint8Array) => void;
  readonly stop: () => void;
  readonly cancel: () => void;
}

export class MicrophoneOff extends Error {
  override readonly message = "The glasses microphone didn't start";
}

// A retry waits for the preceding recording's microphone to turn off.
const microphones = new WeakMap<Glasses, Promise<void>>();

export const listen = (
  glasses: Glasses,
  polaris: Pick<PolarisClient, "transcribe">,
  hostId: string,
  callbacks: VoiceCallbacks
): Listening => {
  const feed = audioFeed();
  const previous = microphones.get(glasses) ?? Promise.resolve();
  const released = Promise.withResolvers<void>();
  microphones.set(glasses, released.promise);
  let transcripts: AsyncIterator<Transcript> | null = null;
  let live = true;
  let stopped = false;
  let turningOff: Promise<void> | null = null;
  let last: Transcript = { finalText: "", interimText: "", finished: false };

  const started = previous.then(async () => {
    if (!live || stopped) return;

    if (!(await glasses.microphone(true))) throw new MicrophoneOff();
  });

  const stopMicrophone = () => {
    stopped = true;
    feed.end();
    turningOff ??= started
      .catch(() => undefined)
      .then(async () => {
        try {
          await glasses.microphone(false);
        } finally {
          released.resolve();
        }
      });
    // A bridge failure must not become an unhandled rejection or block the next recording.
    void turningOff.catch(() => undefined);
  };

  const cancel = () => {
    live = false;
    feed.cancel();
    stopMicrophone();
    void transcripts?.return?.().catch(() => undefined);
  };

  const run = async () => {
    await started;

    if (!live) return;
    transcripts = polaris.transcribe(hostId, feed)[Symbol.asyncIterator]();

    try {
      while (live) {
        const next = await transcripts.next();

        if (!live) return;

        if (next.done === true) break;
        last = next.value;
        callbacks.heard(last);

        if (last.finished) return;
      }

      if (live) callbacks.heard({ ...last, interimText: "", finished: true });
    } finally {
      feed.cancel();
      stopMicrophone();
      await transcripts.return?.();
    }
  };

  void run()
    .catch((cause: unknown) => {
      if (live) callbacks.failed(cause);
    })
    .finally(stopMicrophone);

  return {
    push: (pcm) => {
      if (feed.push(pcm)) return;
      cancel();
      callbacks.failed(new Error("Audio couldn't keep up. Retry your reply."));
    },
    stop: stopMicrophone,
    cancel,
  };
};
