/** How a worker row reads: its glyph, its state word and that word's tone (rule/constellation-colour). */
import type { TaskGlyphKind } from "../glyphs.tsx";
import type { WorkerRow, WorkerState } from "./leadGroups.ts";

export type WorkerTone = "needs-you" | "accepted" | "failed" | "subtle";

interface Shown {
  readonly glyph: TaskGlyphKind;
  /** Null shows the Attempt's age instead. */
  readonly word: string | null;
  readonly tone: WorkerTone;
}

const SHOWN: Readonly<Record<WorkerState, Shown>> = {
  "needs-you": { glyph: "needs-you", word: "needs you", tone: "needs-you" },
  unclaimed: { glyph: "needs-you", word: "stopped", tone: "needs-you" },
  stale: { glyph: "needs-you", word: "stale", tone: "needs-you" },
  review: { glyph: "review", word: "review", tone: "subtle" },
  "handed-up": { glyph: "review", word: "handed to you", tone: "needs-you" },
  working: { glyph: "working", word: null, tone: "subtle" },
  "waiting-slot": { glyph: "waiting", word: "waiting", tone: "subtle" },
  "sent-back": { glyph: "waiting", word: "sent back", tone: "subtle" },
  failed: { glyph: "failed", word: "failed", tone: "failed" },
  lost: { glyph: "stopped", word: "lost", tone: "subtle" },
  unverified: { glyph: "stopped", word: "unverified", tone: "subtle" },
  accepted: { glyph: "accepted", word: "done", tone: "accepted" },
};

export const shownWorker = (row: WorkerRow): Shown => {
  const shown = SHOWN[row.state];

  return row.state === "review" && !row.fetched ? { ...shown, glyph: "review-unfetched" } : shown;
};

export const TONE_CLASS: Readonly<Record<WorkerTone, string>> = {
  "needs-you": "text-needs-you-text",
  accepted: "text-accepted-text",
  failed: "text-failed-text",
  subtle: "text-text-subtle",
};
