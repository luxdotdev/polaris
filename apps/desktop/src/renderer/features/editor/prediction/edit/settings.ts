/**
 * Edit Prediction settings as the Editor reads them (docs/specs/edit-prediction-v1.1.md §7): the
 * main process's per-Host preferences with their derived restraints, defaulting to Full display
 * and Balanced aggressiveness until the Settings slice wires them.
 */
import {
  DEFAULT_PREDICTION_PREFERENCES,
  type PredictionPreferenceView,
  predictionPreferenceView,
} from "../../../../../shared/predictionPlacement.ts";

export type EditPredictionSettings = PredictionPreferenceView;

export const DEFAULT_EDIT_PREDICTION_SETTINGS: EditPredictionSettings = predictionPreferenceView(
  DEFAULT_PREDICTION_PREFERENCES
);

/** Past this many removed lines a deletion needs a second Tab (§5). */
export const LARGE_DELETION_LINES = 5;

/** Tab this soon after a prediction appears types a Tab instead of accepting (§5). */
export const TAB_GUARD_MS = 100;
