/**
 * The Edit Prediction the Editor holds (docs/specs/edit-prediction-v1.1.md §4–§6): its hunks in
 * the buffer they were predicted for, where the model puts the cursor, and the step Tab is at.
 */
import type { Text } from "@codemirror/state";
import type { EditPredictionFormat, PredictedEdit } from "@polaris/protocol";
import type { PredictionKind } from "../../../../../shared/predictionOutcomes.ts";
import { LARGE_DELETION_LINES } from "./settings.ts";

/** What one `prediction.edit` request returned, as the port hands it to the Editor. */
export interface EditFinal {
  readonly edits: ReadonlyArray<PredictedEdit>;
  readonly cursor: number | null;
  readonly window: { readonly from: number; readonly to: number };
  readonly elapsedMs: number;
  readonly model: string;
  readonly format: EditPredictionFormat;
  readonly side: "client" | "host";
}

/** An import: the language server's quick fix, applied only while its edit fence holds. */
export interface ImportFix {
  /** The server's title, the hint's label. */
  readonly title: string;
  readonly current: () => boolean;
}

/** Shown; armed after the first Tab on a large deletion; jumped after the first Tab on a jump. */
export type EditPhase = "shown" | "armed" | "jumped";

export interface EditPrediction {
  readonly id: string;
  /** Sorted by `from`, non-overlapping, in `doc`. */
  readonly hunks: ReadonlyArray<PredictedEdit>;
  /** Where the cursor goes after acceptance, in the buffer after the hunks. */
  readonly cursor: number | null;
  readonly window: { readonly from: number; readonly to: number };
  /** The buffer the hunks were predicted for: the fence at display and at accept. */
  readonly doc: Text;
  /** The cursor when the request was made. */
  readonly anchor: number;
  readonly phase: EditPhase;
  /** `performance.now()` when it appeared, for the 100 ms Tab guard. */
  readonly shownAt: number;
  /** Final to shown, in ms, for the outcome log. */
  readonly finalToShown: number;
  readonly model: string;
  /** Null for an import. */
  readonly format: EditPredictionFormat | null;
  readonly side: "client" | "host";
  readonly requestToFinal: number;
  readonly import?: ImportFix;
}

export const sortHunks = (hunks: ReadonlyArray<PredictedEdit>): ReadonlyArray<PredictedEdit> =>
  [...hunks].sort((a, b) => a.from - b.from || a.to - b.to);

/** In bounds and non-overlapping; two insertions may share a position. */
export const hunksValid = (doc: Text, hunks: ReadonlyArray<PredictedEdit>): boolean => {
  let end = -1;

  for (const hunk of hunks) {
    if (hunk.from < 0 || hunk.to < hunk.from || hunk.to > doc.length || hunk.from < end)
      return false;
    end = hunk.to;
  }

  return hunks.length > 0;
};

export const hunkKind = (hunks: ReadonlyArray<PredictedEdit>): PredictionKind => {
  if (hunks.every((hunk) => hunk.text.length === 0)) return "delete";

  if (hunks.every((hunk) => hunk.from === hunk.to)) return "insert";

  return "replace";
};

/** The removed range covers whole lines: starts at a line start and ends at one (or the end). */
export const removesWholeLines = (doc: Text, hunk: PredictedEdit): boolean =>
  hunk.from < hunk.to &&
  doc.lineAt(hunk.from).from === hunk.from &&
  (hunk.to === doc.length || doc.lineAt(hunk.to).from === hunk.to);

const linesSpanned = (doc: Text, hunk: PredictedEdit): number =>
  doc.lineAt(Math.max(hunk.from, hunk.to - 1)).number - doc.lineAt(hunk.from).number + 1;

/** Whole lines the prediction removes; a within-line removal counts none. */
export const linesRemoved = (doc: Text, hunks: ReadonlyArray<PredictedEdit>): number =>
  hunks.reduce(
    (sum, hunk) => sum + (removesWholeLines(doc, hunk) ? linesSpanned(doc, hunk) : 0),
    0
  );

export const linesAdded = (hunks: ReadonlyArray<PredictedEdit>): number =>
  hunks.reduce((sum, hunk) => {
    if (hunk.text.length === 0) return sum;
    const breaks = hunk.text.split("\n").length - 1;

    return sum + (hunk.text.endsWith("\n") ? breaks : breaks + 1);
  }, 0);

export const isLargeDeletion = (doc: Text, hunks: ReadonlyArray<PredictedEdit>): boolean =>
  hunkKind(hunks) === "delete" && linesRemoved(doc, hunks) > LARGE_DELETION_LINES;

/** The 1-based line the first hunk starts on. */
export const targetLine = (doc: Text, hunks: ReadonlyArray<PredictedEdit>): number =>
  doc.lineAt(hunks[0]?.from ?? 0).number;

/** A prediction whose first hunk is off the cursor line ± 1 is a jump (§4). */
export const isJump = (doc: Text, hunks: ReadonlyArray<PredictedEdit>, cursor: number): boolean =>
  Math.abs(targetLine(doc, hunks) - doc.lineAt(cursor).number) > 1;

/** Still waiting for the first Tab to move the cursor there. */
export const jumpPending = (prediction: EditPrediction): boolean =>
  prediction.import === undefined &&
  prediction.phase === "shown" &&
  isJump(prediction.doc, prediction.hunks, prediction.anchor);

export const kindOf = (prediction: EditPrediction): PredictionKind => {
  if (prediction.import !== undefined) return "import";

  return jumpPending(prediction) ? "jump" : hunkKind(prediction.hunks);
};

export type TabDecision = "jump" | "arm" | "apply";

/** What the next Tab does: jumps first, arms a large deletion once, then applies. */
export const tabDecision = (prediction: EditPrediction): TabDecision => {
  if (jumpPending(prediction)) return "jump";

  if (prediction.phase !== "armed" && isLargeDeletion(prediction.doc, prediction.hunks))
    return "arm";

  return "apply";
};

let nextId = 0;

export const predictionId = () => `ep-${Date.now().toString(36)}-${(nextId++).toString(36)}`;
