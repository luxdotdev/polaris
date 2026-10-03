/** How a worker row reads: its glyph, its state word and that word's tone (rule/constellation-colour). */
import type { TaskGlyphKind } from "../glyphs.tsx";
import { setupExit } from "../../constellation/model/setup.ts";
import type { LeadWorker, WorkerState } from "./leadGroups.ts";

export type WorkerTone = "needs-you" | "accepted" | "failed" | "subtle";

interface Shown {
  readonly glyph: TaskGlyphKind;
  /** Null shows the Attempt's age instead. */
  readonly word: string | null;
  readonly tone: WorkerTone;
}

const SHOWN: Readonly<Record<WorkerState, Shown>> = {
  blocked: { glyph: "waiting", word: "blocked", tone: "subtle" },
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
  accepted: { glyph: "accepted", word: "done", tone: "accepted" },
  "setting-up": { glyph: "waiting", word: "setting up", tone: "subtle" },
  "setup-failed": { glyph: "needs-you", word: "setup failed", tone: "needs-you" },
};

export const shownWorker = (row: LeadWorker): Shown => {
  const shown = SHOWN[row.state];

  return row.kind === "attempt" && row.state === "review" && !row.fetched
    ? { ...shown, glyph: "review-unfetched" }
    : shown;
};

/** A setup row's hover: "setting up · bun install · 1m", or "bun install exited 1". */
export const setupHover = (
  setup: { readonly command: string; readonly exitCode: number | null },
  failed: boolean,
  age: string
) => (failed ? `${setup.command} ${setupExit(setup)}` : `setting up · ${setup.command} · ${age}`);

export const TONE_CLASS: Readonly<Record<WorkerTone, string>> = {
  "needs-you": "text-needs-you-text",
  accepted: "text-accepted-text",
  failed: "text-failed-text",
  subtle: "text-text-subtle",
};
