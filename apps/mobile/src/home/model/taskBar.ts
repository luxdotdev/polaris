/**
 * A constellation row's seven-segment bar (Paper H4): done tasks lit, working ones faint, the
 * rest dark, scaled to seven whatever the task count.
 */
export type Segment = "done" | "working" | "rest";

export const SEGMENTS = 7;

export interface ConstellationProgress {
  readonly done: number;
  readonly working: number;
  readonly total: number;
}

export const sevenSegments = ({
  done,
  working,
  total,
}: ConstellationProgress): ReadonlyArray<Segment> => {
  if (total <= 0) return Array.from({ length: SEGMENTS }, () => "rest");
  const lit = Math.round((Math.min(done, total) / total) * SEGMENTS);

  const faint = Math.min(
    SEGMENTS - lit,
    working > 0 ? Math.max(1, Math.round((working / total) * SEGMENTS)) : 0
  );

  return Array.from({ length: SEGMENTS }, (_, index) =>
    index < lit ? "done" : index < lit + faint ? "working" : "rest"
  );
};

/** "3 of 7 tasks · lead", or just "lead" before the graph has loaded. */
export const progressLine = (progress: ConstellationProgress | null): string =>
  progress === null
    ? "lead"
    : `${progress.done} of ${progress.total} ${progress.total === 1 ? "task" : "tasks"} · lead`;
