/**
 * The Editor's Edit Prediction state: the prediction and its phase, the sticky Esc, whether a
 * mouse selection is in progress, whether ⌥ is held, and the Display setting as a facet.
 */
import {
  Annotation,
  type EditorState,
  Facet,
  StateEffect,
  StateField,
  type Transaction,
} from "@codemirror/state";
import { popupOrSnippet } from "../state.ts";
import type { EditPhase, EditPrediction } from "./model.ts";
import type { EditPredictionSettings } from "./settings.ts";

export const setEditPrediction = StateEffect.define<EditPrediction | null>();

export const setEditPhase = StateEffect.define<EditPhase>();

/** The jump's own cursor move: the only selection change that keeps the prediction. */
export const editMove = Annotation.define<boolean>();

const applyEffects = (value: EditPrediction | null, tr: Transaction) => {
  let next = value;

  for (const effect of tr.effects) {
    if (effect.is(setEditPrediction)) next = effect.value;
    else if (effect.is(setEditPhase) && next !== null) next = { ...next, phase: effect.value };
  }

  return next;
};

export const editPrediction = StateField.define<EditPrediction | null>({
  create: () => null,
  update(value, tr) {
    const cleared = tr.docChanged || (tr.selection && !tr.annotation(editMove)) ? null : value;

    return applyEffects(cleared, tr);
  },
});

/** Esc on a line keeps predictions away until the cursor leaves it or Enter is pressed. */
export interface Suppression {
  /** The suppressed line's start, mapped through edits. */
  readonly at: number;
  /** What Esc dismissed, for "Show last edit prediction". */
  readonly last: EditPrediction | null;
}

export const suppressLine = StateEffect.define<Suppression>();

export const liftSuppression = StateEffect.define<null>();

const stillSuppressed = (value: Suppression, tr: Transaction): Suppression | null => {
  let enter = false;
  tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
    if (inserted.toString().includes("\n")) enter = true;
  });

  if (enter) return null;
  const at = tr.changes.mapPos(value.at, -1);

  return tr.state.doc.lineAt(tr.state.selection.main.head).from === at ? { ...value, at } : null;
};

export const suppression = StateField.define<Suppression | null>({
  create: () => null,
  update(value, tr) {
    let next =
      value !== null && (tr.docChanged || tr.selection) ? stillSuppressed(value, tr) : value;

    for (const effect of tr.effects) {
      if (effect.is(suppressLine)) next = effect.value;
      else if (effect.is(liftSuppression)) next = null;
    }

    return next;
  },
});

export const setPointerSelecting = StateEffect.define<boolean>();

/** True between mousedown in the content and mouseup: no predictions meanwhile (§5). */
export const pointerSelecting = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    let next = value;

    for (const effect of tr.effects) if (effect.is(setPointerSelecting)) next = effect.value;

    return next;
  },
});

export const setAltHeld = StateEffect.define<boolean>();

/** ⌥ held: Subtle display previews the prediction in place (§6). */
export const altHeld = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    let next = tr.docChanged ? false : value;

    for (const effect of tr.effects) if (effect.is(setAltHeld)) next = effect.value;

    return next;
  },
});

type Display = EditPredictionSettings["display"];

export const editDisplay = Facet.define<Display, Display>({
  combine: (values) => values[0] ?? "full",
});

/** The prediction the user can see and accept: none during a selection, popup or snippet. */
export const visibleEditPrediction = (state: EditorState): EditPrediction | null => {
  const value = state.field(editPrediction, false);

  return value !== null &&
    value !== undefined &&
    state.selection.ranges.length === 1 &&
    state.selection.main.empty &&
    !state.field(pointerSelecting, false) &&
    !popupOrSnippet(state)
    ? value
    : null;
};

/** Full in Full display, and in Subtle while ⌥ is held. */
export const drawsInPlace = (state: EditorState): boolean =>
  state.facet(editDisplay) === "full" || state.field(altHeld, false) === true;
