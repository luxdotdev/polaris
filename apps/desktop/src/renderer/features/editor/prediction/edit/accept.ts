/** Tab and Esc on an Edit Prediction (docs/specs/edit-prediction-v1.1.md §4–§5). */
import { ChangeSet } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { currentMode } from "../../cm/vim.ts";
import { acceptedPrediction } from "../state.ts";
import { inLeadingWhitespace, tooSoonToAccept } from "./guards.ts";
import { editAccepted } from "./history.ts";
import { type EditPrediction, hunksValid, type TabDecision, tabDecision } from "./model.ts";
import {
  editMove,
  editPrediction,
  setEditPhase,
  setEditPrediction,
  suppressLine,
  visibleEditPrediction,
} from "./state.ts";

const insertMode = (view: EditorView) => {
  const mode = currentMode(view);

  return mode === null || mode === "insert";
};

const firstHunkOnCursorLine = (view: EditorView, prediction: EditPrediction) => {
  const { doc, selection } = view.state;

  return (
    doc.lineAt(prediction.hunks[0]?.from ?? 0).number === doc.lineAt(selection.main.head).number
  );
};

/** All hunks in one transaction (one undo step), annotated, then the cursor to `Final.cursor`. */
export const applyEditPrediction = (view: EditorView, prediction: EditPrediction) => {
  const changes = ChangeSet.of(
    prediction.hunks.map((hunk) => ({ from: hunk.from, to: hunk.to, insert: hunk.text })),
    view.state.doc.length
  );

  const last = prediction.hunks.at(-1);
  const fallback = last === undefined ? 0 : changes.mapPos(last.to, 1);
  const anchor = Math.min(prediction.cursor ?? fallback, changes.newLength);
  view.dispatch({
    changes,
    selection: { anchor },
    annotations: [acceptedPrediction.of(true), editAccepted.of(prediction)],
    effects: setEditPrediction.of(null),
    userEvent: "input.complete",
    scrollIntoView: true,
  });
};

const jumpTo = (view: EditorView, prediction: EditPrediction) => {
  const at = prediction.hunks[0]?.from ?? 0;
  view.dispatch({
    selection: { anchor: at },
    effects: [setEditPhase.of("jumped"), EditorView.scrollIntoView(at, { y: "center" })],
    annotations: editMove.of(true),
  });
};

const arm = (view: EditorView) => view.dispatch({ effects: setEditPhase.of("armed") });

const STEPS: Record<TabDecision, (view: EditorView, prediction: EditPrediction) => void> = {
  jump: jumpTo,
  arm,
  apply: applyEditPrediction,
};

/** Tab: false lets the key type a Tab (the 100 ms and leading-whitespace guards, no prediction). */
export const acceptEditPrediction = (view: EditorView, now = performance.now()): boolean => {
  const prediction = visibleEditPrediction(view.state);

  if (prediction === null || !insertMode(view) || tooSoonToAccept(prediction.shownAt, now))
    return false;

  if (inLeadingWhitespace(view.state) && !firstHunkOnCursorLine(view, prediction)) return false;

  if (view.state.doc !== prediction.doc || !hunksValid(view.state.doc, prediction.hunks)) {
    view.dispatch({ effects: setEditPrediction.of(null) });

    return false;
  }

  STEPS[tabDecision(prediction)](view, prediction);

  return true;
};

/** Esc: drops the prediction and keeps the line quiet until the cursor leaves it or Enter. */
export const dismissEditPrediction = (view: EditorView): boolean => {
  const prediction = view.state.field(editPrediction, false) ?? null;
  const { doc, selection } = view.state;
  view.dispatch({
    effects: [
      suppressLine.of({ at: doc.lineAt(selection.main.head).from, last: prediction }),
      setEditPrediction.of(null),
    ],
  });

  return prediction !== null;
};
