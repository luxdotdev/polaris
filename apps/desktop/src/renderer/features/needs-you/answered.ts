/**
 * Requests this device answered (in the inbox, a hover card, a notification or the
 * conversation's own card through `respond`), so their resolution isn't shown as news.
 */
const answered = new Set<string>();

const listeners = new Set<() => void>();

let snapshot: ReadonlySet<string> = new Set();

export const markAnswered = (requestId: string) => {
  answered.add(requestId);
  snapshot = new Set(answered);

  for (const listener of listeners) listener();
};

export const answeredHere = {
  subscribe: (listener: () => void) => {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  },
  get: (): ReadonlySet<string> => snapshot,
};
