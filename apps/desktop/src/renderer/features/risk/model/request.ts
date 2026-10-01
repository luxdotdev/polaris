/** Pure parts of which summary a Review asks for (`data/request.ts`). */

/** The head each subject was first summarised at, and the one before its latest move. */
const heads = new Map<string, { readonly head: string; readonly since: string | null }>();

/** `since` for a checkout at `head`: null at first, then the head it moved from. */
export const sinceFor = (key: string, head: string): string | null => {
  const seen = heads.get(key);

  if (seen === undefined) {
    heads.set(key, { head, since: null });

    return null;
  }

  if (seen.head === head) return seen.since;
  heads.set(key, { head, since: seen.head });

  return seen.head;
};

const IN_FLIGHT: ReadonlySet<string> = new Set(["starting", "working", "needs-you"]);

/** Turns that have ended: the one in flight, if any, isn't reviewed until it ends. */
export const finishedTurns = (state: string, turnCount: number) =>
  IN_FLIGHT.has(state) ? Math.max(0, turnCount - 1) : turnCount;
