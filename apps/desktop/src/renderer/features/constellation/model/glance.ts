/**
 * The Constellation glance's words (Paper X-H): the hero's progress kicker and the "For you"
 * well, loudest first. Pure, so it is tested.
 */
import type { Attention } from "./look.ts";
import type { Segment } from "./strip.ts";
import type { TaskRow } from "./task.ts";

export interface ForYou {
  readonly row: TaskRow;
  readonly text: string;
}

const SAYS: Readonly<Record<Attention["kind"], (title: string, a: Attention) => string>> = {
  question: (title, a) => (a.kind === "question" ? `${title} asks: “${a.text}”` : title),
  handed: (title) => `${title}: the lead handed it up for your review`,
  approval: (title) => `${title} waits for your approval`,
  stopped: (title) => `${title} stopped without claiming`,
  setup: (title) => `${title}: worktree setup failed`,
  stalled: (title) => `${title} holds a slot and hasn't started`,
};

const failedText = (row: TaskRow) => {
  const reason = row.attempt?.settleReason ?? null;

  return reason === null || reason === ""
    ? `${row.task.title} failed`
    : `${row.task.title} failed: ${reason}`;
};

/** What the user owes the graph: Tasks that need you, then failures that are the worker's. */
export const forYou = (rows: ReadonlyArray<TaskRow>): ReadonlyArray<ForYou> => [
  ...rows.flatMap((row) =>
    row.look.attention === null
      ? []
      : [{ row, text: SAYS[row.look.attention.kind](row.task.title, row.look.attention) }]
  ),
  ...rows.flatMap((row) =>
    row.look.attention === null && row.look.glyph === "failed"
      ? [{ row, text: failedText(row) }]
      : []
  ),
];

export interface Progress {
  readonly accepted: number;
  readonly total: number;
  readonly working: number;
  readonly needsYou: number;
}

export const progressOf = (segments: ReadonlyArray<Segment>): Progress => ({
  accepted: segments.filter((s) => s.tone === "accepted").length,
  total: segments.length,
  working: segments.filter((s) => s.tone === "working").length,
  needsYou: segments.filter((s) => s.tone === "needs-you").length,
});
