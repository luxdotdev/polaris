/**
 * One push-to-talk transcription: the glasses' microphone streams into the
 * Host's `transcribe` until it is stopped, cancelled or fails.
 */
import type { PolarisClient, Transcript } from "@polaris/sdk";
import type { Glasses } from "../glasses/bridge.ts";
import { audioFeed } from "../voice/audio.ts";

export interface VoiceCallbacks {
  readonly heard: (transcript: Transcript) => void;
  readonly failed: (cause: unknown) => void;
}

export interface Listening {
  readonly push: (pcm: Uint8Array) => void;
  /** Ends the audio; the Host then sends its last, finished transcript. */
  readonly stop: () => void;
  /** Stops at once; nothing more is reported. */
  readonly cancel: () => void;
}

export class MicrophoneOff extends Error {
  override readonly message = "The glasses microphone didn't start";
}

export const listen = (
  glasses: Glasses,
  polaris: PolarisClient,
  hostId: string,
  callbacks: VoiceCallbacks
): Listening => {
  const feed = audioFeed();
  const transcripts = polaris.transcribe(hostId, feed)[Symbol.asyncIterator]();
  let live = true;
  let last: Transcript = { finalText: "", interimText: "", finished: false };

  const stopMicrophone = () => {
    feed.end();
    void glasses.microphone(false);
  };

  const run = async () => {
    if (!(await glasses.microphone(true))) throw new MicrophoneOff();

    while (live) {
      const next = await transcripts.next();

      if (!live) return;

      if (next.done === true) break;
      last = next.value;
      callbacks.heard(last);

      if (last.finished) return;
    }
    // The feed ended without a finished transcript: settle on what was heard.

    if (live) callbacks.heard({ ...last, interimText: "", finished: true });
  };

  void run()
    .catch((cause: unknown) => {
      if (live) callbacks.failed(cause);
    })
    .finally(stopMicrophone);

  return {
    push: (pcm) => feed.push(pcm),
    stop: stopMicrophone,
    cancel: () => {
      live = false;
      stopMicrophone();
      void transcripts.return?.();
    },
  };
};
