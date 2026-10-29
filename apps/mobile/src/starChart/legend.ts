/** The legend under the chart: what needs you first, then the rest as a quiet count (MX-W, MX-X). */
import type { StarState, StarTask } from "./types.ts";

export type StarCounts = Readonly<Record<StarState, number>>;

export const starCounts = (tasks: ReadonlyArray<StarTask>): StarCounts => {
  const counts: Record<StarState, number> = {
    done: 0,
    working: 0,
    review: 0,
    blocked: 0,
    failed: 0,
    waiting: 0,
  };

  for (const task of tasks) counts[task.state] += 1;

  return counts;
};

export interface Legend {
  /** Amber: claims waiting for the lead's review. */
  readonly review: string | null;
  /** Red: blocked and failed tasks. */
  readonly trouble: string | null;
  /** Faint: working and waiting; left out of the compressed chart, which has "View all tasks". */
  readonly rest: string | null;
}

const count = (n: number, one: string, many: string = one): string | null =>
  n === 0 ? null : `${n} ${n === 1 ? one : many}`;

const joined = (parts: ReadonlyArray<string | null>): string | null => {
  const present = parts.filter((part) => part !== null);

  return present.length === 0 ? null : present.join(" · ");
};

export const legend = (tasks: ReadonlyArray<StarTask>, compact: boolean): Legend => {
  const counts = starCounts(tasks);

  return {
    review: compact
      ? count(counts.review, "claim", "claims")
      : count(counts.review, "claim to review", "claims to review"),
    trouble: joined([count(counts.blocked, "blocked"), count(counts.failed, "failed")]),
    rest: compact
      ? null
      : joined([count(counts.working, "working"), count(counts.waiting, "waiting")]),
  };
};
