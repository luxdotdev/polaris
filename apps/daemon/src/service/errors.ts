import { Schema } from "effect";

export class InstallError extends Schema.TaggedError<InstallError>()("InstallError", {
  step: Schema.String,
  message: Schema.String,
}) {}

/**
 * Windows: the name this home's task would take holds another task: another installed
 * Polaris home's, another account's, or not Polaris'. `polaris install` exits 3 with it.
 */
export class TaskConflictError extends Schema.TaggedError<TaskConflictError>()(
  "TaskConflictError",
  {
    task: Schema.String,
    /** The home this install is for. */
    home: Schema.String,
    /** The home the existing task runs, or null when it isn't this user's Polaris task (or can't be read). */
    otherHome: Schema.NullOr(Schema.String),
  }
) {
  override get message(): string {
    const owner =
      this.otherHome === null
        ? "is not your Polaris task"
        : `runs the Polaris home ${this.otherHome}`;

    return `the scheduled task ${this.task} ${owner}, not ${this.home}; left it alone. Pass --replace-task to take it over.`;
  }
}

/** The exit code `polaris install` and `upgrade` report a `TaskConflictError` with. */
export const EXIT_TASK_CONFLICT = 3;
