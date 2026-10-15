/**
 * Import lookups for one Editor (docs/specs/edit-prediction-v1.1.md §5 "Imports"): after a burst
 * settles or an acceptance, ask the view's `importSource` about the changed lines. A model
 * prediction wins: an import found while one is pending or shown waits until the model has none.
 */
import type { ChangeSet, EditorState, Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { type ImportCandidate, importSource } from "../imports/index.ts";
import { historyOf } from "./history.ts";
import { type EditPrediction, predictionId } from "./model.ts";

export interface ImportHost {
  /** A model request is in flight or a model prediction is held. */
  readonly modelBusy: () => boolean;
  readonly show: (prediction: EditPrediction) => void;
}

type Range = { readonly from: number; readonly to: number };

/** The changes' extent in the new buffer, widened to whole lines; null when nothing changed. */
export const changedLines = (doc: Text, changes: ChangeSet): Range | null => {
  let from = Number.POSITIVE_INFINITY;
  let to = -1;
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    from = Math.min(from, fromB);
    to = Math.max(to, toB);
  });

  if (to < 0) return null;

  return { from: doc.lineAt(from).from, to: doc.lineAt(to).to };
};

/** The current burst's changed lines. */
export const burstLines = (state: EditorState): Range | null => {
  const { burst } = historyOf(state);

  return burst === null ? null : changedLines(state.doc, burst.changes);
};

const importPrediction = (
  candidate: ImportCandidate,
  anchor: number,
  startedAt: number
): EditPrediction => {
  const now = performance.now();

  return {
    id: predictionId(),
    hunks: candidate.hunks,
    cursor: null,
    window: { from: 0, to: candidate.doc.length },
    doc: candidate.doc,
    anchor,
    phase: "shown",
    shownAt: now,
    finalToShown: 0,
    model: "",
    format: null,
    side: "host",
    requestToFinal: now - startedAt,
    import: { title: candidate.title, current: candidate.current },
  };
};

export class ImportLookups {
  private controller: AbortController | null = null;
  private held: EditPrediction | null = null;
  constructor(
    private readonly view: EditorView,
    private readonly host: ImportHost
  ) {}
  private fresh(prediction: EditPrediction) {
    const { state } = this.view;

    return state.doc === prediction.doc && state.selection.main.head === prediction.anchor;
  }
  start(range: Range | null) {
    this.cancel();
    const source = this.view.state.facet(importSource);

    if (source === null || range === null) return;
    const controller = new AbortController();
    this.controller = controller;
    const startedAt = performance.now();
    const anchor = this.view.state.selection.main.head;

    void source.find(range, controller.signal).then((candidate) => {
      if (this.controller !== controller || controller.signal.aborted) return;
      this.controller = null;

      if (candidate === null) return;
      const prediction = importPrediction(candidate, anchor, startedAt);

      if (!this.fresh(prediction)) return;

      if (this.host.modelBusy()) this.held = prediction;
      else this.host.show(prediction);
    });
  }
  /** The model answered with nothing to show: a held import shows if the buffer is unchanged. */
  release() {
    const held = this.held;
    this.held = null;

    if (held !== null && this.fresh(held)) this.host.show(held);
  }
  cancel() {
    this.controller?.abort();
    this.controller = null;
    this.held = null;
  }
}
