/**
 * The Edit Prediction path of tab completion (docs/specs/edit-prediction-v1.1.md §4–§6): history,
 * requests, state, display and Tab, installed beside v1's ghost and active when a next-edit model
 * serves the Workspace. `prediction/index.ts` orders the keys between the two.
 */
import { type Extension, StateField } from "@codemirror/state";
import { type DecorationSet, EditorView, ViewPlugin } from "@codemirror/view";
import { openPopupOrSnippet } from "../state.ts";
import { dismissEditPrediction } from "./accept.ts";
import { decorationsOf, editTheme } from "./decorations.ts";
import { edgeMarker } from "./edge.ts";
import { editHistory } from "./history.ts";
import { displayCompartment, editPort, type EditPredictionPort, editRequests } from "./requests.ts";
import {
  altHeld,
  editDisplay,
  editPrediction,
  pointerSelecting,
  setAltHeld,
  setEditPrediction,
  setPointerSelecting,
  suppression,
} from "./state.ts";

const editDecorations = StateField.define<DecorationSet>({
  create: decorationsOf,
  update: (_value, tr) => decorationsOf(tr.state),
  provide: (field) => EditorView.decorations.from(field),
});

/** A mouse selection in progress: the pointer went down in the content and is not up yet. */
const pointerWatch = ViewPlugin.define((view) => {
  // Pointer events are their own tasks, never inside an update, so dispatching here is safe.
  const set = (selecting: boolean) => {
    if (view.state.field(pointerSelecting) !== selecting)
      view.dispatch({ effects: setPointerSelecting.of(selecting) });
  };

  const down = (event: PointerEvent) => {
    if (event.button === 0) set(true);
  };

  const up = () => set(false);
  view.contentDOM.addEventListener("pointerdown", down);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);

  return {
    destroy: () => {
      view.contentDOM.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    },
  };
});

const alt = (view: EditorView, held: boolean) => {
  if (view.state.facet(editDisplay) === "subtle" && view.state.field(altHeld) !== held)
    view.dispatch({ effects: setAltHeld.of(held) });

  return false;
};

const events = EditorView.domEventHandlers({
  keydown: (event, view) => (event.key === "Alt" ? alt(view, true) : false),
  keyup: (event, view) => (event.key === "Alt" ? alt(view, false) : false),
  blur: (_event, view) => alt(view, false),
});

/** Esc: cancels pending work and dismisses; true when there was something to dismiss. */
export const dismissEditPredictions = (view: EditorView): boolean => {
  const pending = view.plugin(editRequests)?.dismiss() ?? false;
  const shown = view.state.field(editPrediction, false) ?? null;

  if (!pending && shown === null) return false;

  // Esc over an open completion list closes the list; the hidden prediction just goes.
  if (openPopupOrSnippet(view.state)) {
    view.dispatch({ effects: setEditPrediction.of(null) });

    return false;
  }

  dismissEditPrediction(view);

  return true;
};

export const editPredictionExtension = (port: EditPredictionPort): Extension => [
  editPort.of(port),
  editHistory,
  editPrediction,
  suppression,
  pointerSelecting,
  altHeld,
  displayCompartment.of(editDisplay.of(port.settings().display)),
  editDecorations,
  editTheme,
  editRequests,
  edgeMarker,
  pointerWatch,
  events,
];

export { acceptEditPrediction, applyEditPrediction, dismissEditPrediction } from "./accept.ts";

export {
  editAccepted,
  editHistory,
  FREEZE_PAUSE_MS,
  historyOf,
  MAX_HISTORY_HUNKS,
} from "./history.ts";

export type { EditFinal, EditPhase, EditPrediction } from "./model.ts";

export { onPredictionLog, type PredictionLogRecord, type PredictionOutcome } from "./outcomes.ts";

export {
  type EditPredictionInput,
  type EditPredictionPort,
  showLastEditPrediction,
} from "./requests.ts";

export {
  DEFAULT_EDIT_PREDICTION_SETTINGS,
  type EditPredictionSettings,
  LARGE_DELETION_LINES,
  TAB_GUARD_MS,
} from "./settings.ts";

export {
  editDisplay,
  editPrediction,
  setEditPrediction,
  suppression,
  visibleEditPrediction,
} from "./state.ts";
