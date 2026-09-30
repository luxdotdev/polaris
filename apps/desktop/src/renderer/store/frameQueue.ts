/**
 * Collects feed items and applies them once per animation frame, so a burst
 * of batches from the main process costs one store update and one render.
 * A hidden window gets no frames, so a timeout flushes there instead.
 */

export interface FrameQueue<A> {
  readonly push: (item: A) => void;
  readonly flush: () => void;
}

export interface FrameScheduler {
  readonly frame: (run: () => void) => void;
  readonly timeout: (run: () => void, ms: number) => void;
}

export const browserScheduler: FrameScheduler = {
  frame: (run) => requestAnimationFrame(run),
  timeout: (run, ms) => setTimeout(run, ms),
};

/** Longest an item waits when the window is hidden and frames stop. */
export const HIDDEN_FLUSH_MS = 100;

export interface FrameQueueInput<A> {
  readonly apply: (items: ReadonlyArray<A>) => void;
  readonly scheduler?: FrameScheduler;
}

export const frameQueue = <A>({
  apply,
  scheduler = browserScheduler,
}: FrameQueueInput<A>): FrameQueue<A> => {
  let pending: Array<A> = [];
  let scheduled = false;

  const flush = () => {
    scheduled = false;

    if (pending.length === 0) return;
    const items = pending;

    pending = [];
    apply(items);
  };

  return {
    push: (item) => {
      pending.push(item);

      if (scheduled) return;
      scheduled = true;
      scheduler.frame(flush);
      scheduler.timeout(flush, HIDDEN_FLUSH_MS);
    },
    flush,
  };
};
