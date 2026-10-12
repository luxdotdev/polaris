/**
 * The Space preview's words (Paper 13): the counts line and which Tasks it lists, loudest
 * first. Pure, so it is tested.
 */
import type { Bucket, Tally, TaskRow } from "../../constellation/model/index.ts";

export interface PeekCount {
  readonly bucket: Bucket;
  readonly text: string;
}

const WORDS: ReadonlyArray<readonly [Bucket, string]> = [
  ["done", "done"],
  ["working", "working"],
  ["review", "in review"],
  ["needs-you", "needs you"],
  ["blocked", "blocked"],
  ["waiting", "waiting"],
];

/** "1 done", "1 working", "1 needs you"…: the buckets with Tasks in them. */
export const peekCounts = (tally: Tally): ReadonlyArray<PeekCount> =>
  WORDS.flatMap(([bucket, word]) =>
    tally[bucket] === 0 ? [] : [{ bucket, text: `${tally[bucket]} ${word}` }]
  );

const RANK: Readonly<Record<Bucket, number>> = {
  "needs-you": 0,
  review: 1,
  working: 2,
  blocked: 3,
  waiting: 4,
  done: 5,
  ended: 6,
};

/** The preview lists this many Tasks, then "N more". */
export const PEEK_ROWS = 6;

/** Tasks still in play, needs you first; done and ended ones are only counted. */
export const peekRows = (tasks: ReadonlyArray<TaskRow>) => {
  const open = tasks
    .filter((t) => t.look.bucket !== "done" && t.look.bucket !== "ended")
    .sort((a, b) => RANK[a.look.bucket] - RANK[b.look.bucket]);

  return { shown: open.slice(0, PEEK_ROWS), more: Math.max(0, open.length - PEEK_ROWS) };
};
