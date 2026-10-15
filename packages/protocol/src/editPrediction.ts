import { Schema } from "effect";
import { Rpc } from "effect/rpc";
import { PredictionContext, PredictionEndpoint, PredictionError } from "./prediction.ts";

const Offset = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const Positive = Schema.Int.check(Schema.isGreaterThan(0));

const Text = Schema.String.check(Schema.isMaxLength(1_048_576));

/** `prediction.edit`: region-rewrite next-edit models (docs/specs/edit-prediction-v1.1.md). */
export const EDIT_PREDICTION_CAPABILITY = "prediction.edit" as const;

/** The prompt grammar of a next-edit model; each one rewrites a region around the cursor. */
export const EditPredictionFormat = Schema.Literals(["zeta-2.1", "sweep-next-edit"]);

export type EditPredictionFormat = typeof EditPredictionFormat.Type;

/** One earlier edit by the user, oldest first; the predictor renders it in its format's diff. */
export const EditHistoryHunk = Schema.Struct({
  path: Schema.String,
  /** Zero-based line in the file, after the edit, where `after` starts. */
  line: Offset,
  before: Text,
  after: Text,
});

export type EditHistoryHunk = typeof EditHistoryHunk.Type;

export const EditPredictionRequest = Schema.Struct({
  context: PredictionContext,
  path: Schema.String,
  /** The whole buffer, unsaved edits included. */
  buffer: Text,
  /** Absolute UTF-16 offset into buffer. */
  cursor: Offset,
  /** Where the rewrite window centres; null centres it on the cursor. A jump probe sets it. */
  focus: Schema.NullOr(Offset),
  /** Frozen at the first keystroke of a burst, so the prompt prefix stays cached. */
  history: Schema.Array(EditHistoryHunk).check(Schema.isMaxLength(32)),
  model: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  format: EditPredictionFormat,
  endpoint: PredictionEndpoint,
  maxTokens: Positive.check(Schema.isLessThanOrEqualTo(2048)),
});

export type EditPredictionRequest = typeof EditPredictionRequest.Type;

/** Replace buffer[from, to) with text: an insertion when from === to, a deletion when text is empty. */
export const PredictedEdit = Schema.Struct({ from: Offset, to: Offset, text: Text });

export type PredictedEdit = typeof PredictedEdit.Type;

/** Why the predictor dropped a hunk the model wrote; logged, never shown. */
export const SuppressedReason = Schema.Literals(["revert", "outside-window", "unstable"]);

export type SuppressedReason = typeof SuppressedReason.Type;

export const EditPredictionItem = Schema.TaggedUnion({
  /** Exactly one on success. No edits means the model abstained or every hunk was suppressed. */
  Final: {
    edits: Schema.Array(PredictedEdit).check(Schema.isMaxLength(64)),
    /** Where the model puts the cursor after acceptance, in the buffer after the edits. */
    cursor: Schema.NullOr(Offset),
    /** The buffer range the model was allowed to rewrite. */
    window: Schema.Struct({ from: Offset, to: Offset }),
    suppressed: Schema.Array(
      Schema.Struct({ reason: SuppressedReason, from: Offset, to: Offset })
    ).check(Schema.isMaxLength(64)),
    elapsedMs: Schema.Number,
  },
});

export type EditPredictionItem = typeof EditPredictionItem.Type;

/** Ephemeral like `prediction.complete`: cancelling consumption aborts HTTP; nothing is written. */
export const PredictionEdit = Rpc.make(EDIT_PREDICTION_CAPABILITY, {
  payload: EditPredictionRequest,
  success: EditPredictionItem,
  error: PredictionError,
  stream: true,
});
