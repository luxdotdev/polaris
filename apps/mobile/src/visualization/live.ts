/**
 * Which Visualizations get a live WebView: those on screen or a few rows from it, nearest first,
 * at most `LIVE_FRAMES`. The rest keep their place at their last height without a WebView.
 */

/** Live WebViews at once in a thread; each is its own WebContent process. */
export const LIVE_FRAMES = 3;

/** How many rows past the screen's edge a Visualization still mounts. */
export const LIVE_REACH = 4;

export const liveVisualizations = (
  rows: ReadonlyArray<{ readonly key: string; readonly kind: string }>,
  visible: ReadonlyArray<number>,
  cap: number = LIVE_FRAMES,
  reach: number = LIVE_REACH
): ReadonlySet<string> => {
  if (visible.length === 0) return new Set();
  const low = Math.min(...visible);
  const high = Math.max(...visible);
  const distance = (index: number) => (index < low ? low - index : Math.max(0, index - high));

  const near = rows.flatMap((row, index) =>
    row.kind === "visualization" && distance(index) <= reach
      ? [{ key: row.key, away: distance(index) }]
      : []
  );

  return new Set(
    [...near]
      .sort((a, b) => a.away - b.away)
      .slice(0, cap)
      .map((row) => row.key)
  );
};
