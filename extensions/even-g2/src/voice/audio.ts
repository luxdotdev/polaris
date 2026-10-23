/** A bounded microphone queue; cancellation discards audio that hasn't been consumed. */
export interface AudioFeed extends AsyncIterable<Uint8Array> {
  /** False when the consumer fell behind; the caller must stop recording. */
  readonly push: (pcm: Uint8Array) => boolean;
  readonly end: () => void;
  readonly cancel: () => void;
}

// Two seconds of 16 kHz s16le mono; also bound the overhead of tiny frames.
const MAX_BYTES = 64_000;

const MAX_FRAMES = 256;

export const audioFeed = (): AudioFeed => {
  const frames: Array<Uint8Array> = [];
  let queued = 0;
  let ended = false;
  let wake: (() => void) | null = null;

  const notify = () => {
    wake?.();
    wake = null;
  };

  const cancel = () => {
    ended = true;
    frames.length = 0;
    queued = 0;
    notify();
  };

  return {
    push: (pcm) => {
      if (ended || pcm.byteLength === 0) return true;

      if (queued + pcm.byteLength > MAX_BYTES || frames.length >= MAX_FRAMES) {
        cancel();

        return false;
      }

      frames.push(pcm.slice());
      queued += pcm.byteLength;
      notify();

      return true;
    },
    end: () => {
      ended = true;
      notify();
    },
    cancel,
    async *[Symbol.asyncIterator]() {
      try {
        while (true) {
          const frame = frames.shift();

          if (frame !== undefined) {
            queued -= frame.byteLength;
            yield frame;
          } else if (ended) return;
          else await new Promise<void>((resolve) => (wake = resolve));
        }
      } finally {
        cancel();
      }
    },
  };
};
