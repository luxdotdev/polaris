export const overlap = (from: number, to: number, start: number, end: number) =>
  Math.max(0, Math.min(to, end) - Math.max(from, start));

/** Union overlapping waits so two queued commands do not double-count wall time. */
export const unionDuration = (
  intervals: ReadonlyArray<{ readonly from: number; readonly to: number }>,
  start: number,
  end: number
) => {
  let total = 0;
  let through = start;

  for (const interval of intervals.toSorted((a, b) => a.from - b.from)) {
    const from = Math.max(start, through, interval.from);
    const to = Math.min(end, interval.to);

    if (to > from) total += to - from;
    through = Math.max(through, to);
  }

  return total;
};
