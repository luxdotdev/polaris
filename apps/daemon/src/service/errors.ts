import { Schema } from "effect";

export class InstallError extends Schema.TaggedError<InstallError>()("InstallError", {
  step: Schema.String,
  message: Schema.String,
}) {}

/**
 * Windows: the task this home's install would register already runs another
 * Polaris home, which is still installed. `polaris install` exits 3 with it.
 */
export class TaskConflictError extends Schema.TaggedError<TaskConflictError>()(
  "TaskConflictError",
  {
    task: Schema.String,
    /** The home this install is for. */
    home: Schema.String,
    /** The home the existing task runs, or null when it isn't a Polaris task. */
    otherHome: Schema.NullOr(Schema.String),
  }
) {
  override get message(): string {
    const owner =
      this.otherHome === null ? "is not a Polaris task" : `runs the Polaris home ${this.otherHome}`;

    return `the scheduled task ${this.task} ${owner}, not ${this.home}; left it alone. Pass --replace-task to take it over.`;
  }
}

/** The exit code `polaris install` and `upgrade` report a `TaskConflictError` with. */
export const EXIT_TASK_CONFLICT = 3;
