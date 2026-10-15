/** The renderer's restraint guards (docs/specs/edit-prediction-v1.1.md §5), pure over the state. */
import type { EditorState } from "@codemirror/state";
import type { PredictedEdit } from "@polaris/protocol";
import { type Burst, burstEdits } from "./history.ts";
import { TAB_GUARD_MS } from "./settings.ts";

export type BurstRevert = "recreates-deleted" | "removes-typed";

/** A hunk that brings back text this burst deleted, or removes text this burst typed. */
export const revertsBurst = (
  hunks: ReadonlyArray<PredictedEdit>,
  burst: Burst | null
): BurstRevert | null => {
  if (burst === null) return null;
  const { deleted, inserted } = burstEdits(burst);

  for (const text of deleted) {
    const needle = text.trim();

    if (needle.length === 0) continue;

    if (
      hunks.some((hunk) =>
        needle.length >= 2 ? hunk.text.includes(needle) : hunk.text.trim() === needle
      )
    )
      return "recreates-deleted";
  }

  for (const typed of inserted) {
    if (typed.text.trim().length === 0) continue;

    if (hunks.some((hunk) => hunk.from < hunk.to && hunk.from < typed.to && hunk.to > typed.from))
      return "removes-typed";
  }

  return null;
};

/** Nothing but whitespace before the cursor on its line. */
export const inLeadingWhitespace = (state: EditorState): boolean => {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);

  return /^\s*$/.test(line.text.slice(0, head - line.from));
};

export const tooSoonToAccept = (shownAt: number, now: number): boolean =>
  now - shownAt < TAB_GUARD_MS;
