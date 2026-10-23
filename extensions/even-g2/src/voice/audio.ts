/**
 * The microphone's PCM frames as the async iterable `transcribe` reads:
 * frames pushed before anyone reads are kept, and `end` finishes it.
 */
export interface AudioFeed extends AsyncIterable<Uint8Array> {
  readonly push: (pcm: Uint8Array) => void;
  readonly end: () => void;
}

export const audioFeed = (): AudioFeed => {
  const frames: Array<Uint8Array> = [];
  let ended = false;
  let wake: (() => void) | null = null;

  const notify = () => {
    wake?.();
    wake = null;
  };

  return {
    push: (pcm) => {
      if (ended) return;
      frames.push(pcm);
      notify();
    },
    end: () => {
      ended = true;
      notify();
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        const frame = frames.shift();

        if (frame !== undefined) yield frame;
        else if (ended) return;
        else await new Promise<void>((resolve) => (wake = resolve));
      }
    },
  };
};
