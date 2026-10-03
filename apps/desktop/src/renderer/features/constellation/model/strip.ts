/**
 * The header's progress strip: one 10×4px segment per Task in its state colour, or past
 * about 40 Tasks one proportional bar (DESIGN.md, Header).
 */
import type { HarnessKind } from "@polaris/protocol";
import type { Tally } from "./rail.ts";
import type { TaskRow } from "./task.ts";

export const STRIP_SEGMENTS_MAX = 40;

export type StripTone =
  | "accepted"
  | "working"
  | "blocked"
  | "review"
  | "needs-you"
  | "failed"
  | "waiting";

export interface Segment {
  readonly key: string;
  readonly tone: StripTone;
  readonly harness: HarnessKind | null;
}

const toneOf = (row: TaskRow): StripTone => {
  if (row.look.attention !== null) return "needs-you";

  if (row.look.bucket === "blocked") return "blocked";

  if (row.look.glyph === "waiting") return "waiting";

  switch (row.projection.state) {
    case "done":
      return "accepted";
    case "working":
      return "working";
    case "review":
      return "review";
    case "failed":
      return "failed";
    default:
      return "waiting";
  }
};

export const segments = (rows: ReadonlyArray<TaskRow>): ReadonlyArray<Segment> =>
  rows.flatMap((r) =>
    r.projection.state === "canceled"
      ? []
      : [{ key: r.task.id, tone: toneOf(r), harness: r.harness }]
  );

export interface BarPart {
  readonly tone: StripTone;
  /** A fraction of the whole, 0–1. */
  readonly share: number;
}

const ORDER: ReadonlyArray<StripTone> = [
  "needs-you",
  "review",
  "working",
  "blocked",
  "accepted",
  "failed",
  "waiting",
];

/** A proportional bar in a fixed order, so it reads left to right the same way every time. */
export const bar = (parts: ReadonlyArray<Segment>): ReadonlyArray<BarPart> => {
  const total = parts.length;

  if (total === 0) return [];

  return ORDER.flatMap((tone) => {
    const count = parts.filter((p) => p.tone === tone).length;

    return count === 0 ? [] : [{ tone, share: count / total }];
  });
};

/** A group's 120px bar from its tally: done first, as in C8. */
export const tallyBar = (tally: Tally, total: number): ReadonlyArray<BarPart> => {
  if (total === 0) return [];

  const parts: ReadonlyArray<readonly [StripTone, number]> = [
    ["needs-you", tally["needs-you"]],
    ["review", tally.review],
    ["working", tally.working],
    ["blocked", tally.blocked],
    ["accepted", tally.done],
  ];

  return parts.flatMap(([tone, n]) => (n === 0 ? [] : [{ tone, share: n / total }]));
};
