/**
 * At most `FRAME_BUDGET` Visualization frames are live at once (DESIGN.md, Performance): those on
 * screen first, then those near it, the most recent first. The rest show their last height, empty.
 */
export const FRAME_BUDGET = 4;

export type Nearness = "away" | "near" | "visible";

const RANK: Readonly<Record<Nearness, number>> = { away: 0, near: 1, visible: 2 };

export interface FrameBudget {
  /** Where a mounted frame is now; `away` keeps it listed but never live. */
  readonly place: (key: string, nearness: Nearness) => void;
  readonly remove: (key: string) => void;
  readonly isLive: (key: string) => boolean;
  readonly subscribe: (listener: () => void) => () => void;
}

export const frameBudget = (max = FRAME_BUDGET): FrameBudget => {
  const places = new Map<string, { readonly rank: number; readonly at: number }>();
  const listeners = new Set<() => void>();
  let live: ReadonlySet<string> = new Set();
  let clock = 0;

  const settle = () => {
    const next = new Set(
      [...places]
        .filter(([, place]) => place.rank > 0)
        .sort(([, a], [, b]) => b.rank - a.rank || b.at - a.at)
        .slice(0, max)
        .map(([key]) => key)
    );

    const changed = next.size !== live.size || [...next].some((key) => !live.has(key));

    live = next;

    if (changed) for (const listener of listeners) listener();
  };

  return {
    place: (key, nearness) => {
      const rank = RANK[nearness];

      if (places.get(key)?.rank === rank) return;
      places.set(key, { rank, at: clock++ });
      settle();
    },
    remove: (key) => {
      if (places.delete(key)) settle();
    },
    isLive: (key) => live.has(key),
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  };
};

/** The conversation's budget, shared by every session on screen. */
export const frames = frameBudget();

/** Each Visualization's last height inline, so an unmounted one keeps its place. */
export const lastHeights = new Map<string, number>();
