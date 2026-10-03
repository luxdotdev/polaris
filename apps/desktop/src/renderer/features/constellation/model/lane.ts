/**
 * The id lane (DESIGN.md, Constellation (DAG) → Rows): every row in a view shares one width,
 * fitted to its longest Task id in mono characters, so titles align and ids never wrap.
 */

/** Never narrower than a short id like "B1". */
export const LANE_MIN = 2;

/** Past these widths an id truncates and shows in full on hover. */
export const LANE_MAX = { tab: 18, digest: 18, sidebar: 4 } as const;

/** The lane's width in mono characters for these ids, at most `max`. */
export const laneWidth = (ids: Iterable<string>, max: number) => {
  let longest = LANE_MIN;

  for (const id of ids) longest = Math.max(longest, id.length);

  return Math.min(longest, max);
};

/**
 * The rail's tree geometry in px (DESIGN.md, Constellation (DAG) → Tree): each depth steps
 * right from the trunk, as far as `reach` leaves room for a fold chevron in the 60px rail.
 */
export const RAIL = { trunk: 8, reach: 31, minStep: 7, maxStep: 17 } as const;

/** One step per view, fitted to its deepest row, so every depth keeps its own column. */
export const railStep = (deepest: number) =>
  deepest <= 0
    ? RAIL.maxStep
    : Math.min(RAIL.maxStep, Math.max(RAIL.minStep, Math.floor(RAIL.reach / deepest)));

/** The deepest column the rail draws at this step; deeper rows indent their content instead. */
export const railCap = (step: number) => Math.floor(RAIL.reach / step);

/** A depth's line, from the rail's left edge. */
export const railX = (depth: number, step: number) =>
  RAIL.trunk + Math.min(depth, railCap(step)) * step;
