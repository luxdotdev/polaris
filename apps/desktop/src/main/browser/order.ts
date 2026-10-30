/**
 * Ordering for work main starts and finishes later: a tab's loads, where the latest asked for
 * wins, and a Host's claims and releases, which run one after another in the order asked.
 */

/** Loads that wait for their partition; one asked for since supersedes one still waiting. */
export const latestLoads = <K>(start: (key: K, url: string) => void) => {
  const latest = new Map<K, number>();

  return {
    request: (key: K, url: string, ready: Promise<void>) => {
      const turn = (latest.get(key) ?? 0) + 1;

      latest.set(key, turn);
      void ready.then(() => {
        if (latest.get(key) === turn) start(key, url);
      });
    },
    forget: (key: K) => latest.delete(key),
  };
};

/** Runs each key's tasks one at a time, in the order they were queued; a failure doesn't stop the queue. */
export const queueByKey = <K>(onError: (cause: unknown) => void) => {
  const tails = new Map<K, Promise<void>>();

  return (key: K, task: () => Promise<void>) => {
    const next = (tails.get(key) ?? Promise.resolve()).then(task).then(
      () => {},
      (cause: unknown) => onError(cause)
    );

    tails.set(key, next);
    void next.then(() => {
      if (tails.get(key) === next) tails.delete(key);
    });

    return next;
  };
};
