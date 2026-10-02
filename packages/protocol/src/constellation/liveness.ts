import { Schema } from "effect";
import { TurnId } from "../ids.ts";

const epochMs = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export class WorkerActivity extends Schema.Class<WorkerActivity>("ConstellationWorkerActivity")({
  itemId: Schema.String,
  turnId: TurnId,
  /** Command text or tool name, observed from the worker's own Harness events. */
  command: Schema.String,
  /** Unix epoch milliseconds; Clients derive elapsed time when rendering. */
  startedAt: epochMs,
}) {}

/** Observed facts for one Attempt; null observations are unknown, never invented progress. */
export class WorkerLiveness extends Schema.Class<WorkerLiveness>("ConstellationWorkerLiveness")({
  current: Schema.NullOr(WorkerActivity),
  /** Unix epoch milliseconds of the latest main-session item update or output. */
  lastOutputAt: Schema.NullOr(epochMs),
  contextPercent: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }))),
  /** Inputs queued by the owning Engine's delivery journal. */
  queuedInput: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}) {}
