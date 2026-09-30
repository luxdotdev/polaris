/**
 * A live feed that reopens itself when it fails, after 1 s, then 2 s, … up
 * to 30 s, for as long as it is held. A feed that delivers again starts over
 * at 1 s; one that ends cleanly stays closed.
 */

export const RETRY_FIRST_MS = 1_000;

export const RETRY_MAX_MS = 30_000;

export interface FeedCallbacks {
  /** The feed delivered: it's healthy again. */
  readonly delivered: () => void;
  /** The feed ended with an error. */
  readonly failed: () => void;
}

/** Schedules `run` after `ms`; returns its cancel. */
export type Schedule = (run: () => void, ms: number) => () => void;

const realSchedule: Schedule = (run, ms) => {
  const timer = setTimeout(run, ms);

  return () => clearTimeout(timer);
};

/** Opens `open` now, and again after each failure; returns the close for all of it. */
export const retryingFeed = (
  open: (callbacks: FeedCallbacks) => () => void,
  schedule: Schedule = realSchedule
): (() => void) => {
  let closed = false;
  let delay = RETRY_FIRST_MS;
  let cancel = () => {};

  let close = () => {};

  const start = () => {
    close = open({
      delivered: () => {
        delay = RETRY_FIRST_MS;
      },
      failed: () => {
        if (closed) return;
        cancel = schedule(start, delay);
        delay = Math.min(delay * 2, RETRY_MAX_MS);
      },
    });
  };

  start();

  return () => {
    closed = true;

    cancel();
    close();
  };
};
