import { Schema } from "effect";
import { ConstellationId, TaskId } from "./constellation/domain.ts";
import { Timestamp } from "./ids.ts";

/** Commands run in a worker checkout before its first Turn; null selects Auto. */
export const WorktreeSetup = Schema.TaggedUnion({
  Auto: {},
  Disabled: {},
  Command: { command: Schema.NonEmptyString.check(Schema.isPattern(/\S/)) },
});

export type WorktreeSetup = typeof WorktreeSetup.Type;

/** Setup is Host work, separate from Turns and working worker slots. */
export class WorktreeSetupRun extends Schema.Class<WorktreeSetupRun>("WorktreeSetupRun")({
  id: Schema.String,
  constellationId: ConstellationId,
  taskId: TaskId,
  command: Schema.String,
  cwd: Schema.String,
  status: Schema.Literals(["running", "completed", "failed"]),
  output: Schema.String,
  exitCode: Schema.NullOr(Schema.Int),
  startedAt: Timestamp,
  endedAt: Schema.NullOr(Timestamp),
}) {}
