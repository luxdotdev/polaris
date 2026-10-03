/**
 * The id lane (DESIGN.md, Constellation (DAG) → Rows): every row in a view shares one width,
 * fitted to its longest Task id in mono characters, so titles align and ids never wrap.
 */

/** Never narrower than a short id like "B1". */
export const LANE_MIN = 2;

/** Past these widths an id truncates and shows in full on hover. */
export const LANE_MAX = { tab: 18, digest: 18, sidebar: 9 } as const;

/** The lane's width in mono characters for these ids, at most `max`. */
export const laneWidth = (ids: Iterable<string>, max: number) => {
  let longest = LANE_MIN;

  for (const id of ids) longest = Math.max(longest, id.length);

  return Math.min(longest, max);
};
