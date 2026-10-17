/**
 * What every way of installing on a Host shares: the error, the options and progress of
 * `applyPlan`, and running `polaris install|upgrade --json` to read its report.
 */
import { Data, Effect, Option, Predicate, Schema } from "effect";
import type { DaemonBuild } from "./builds.ts";
import { Ssh } from "./Ssh.ts";
import { stripClixml } from "./windows/powershell.ts";

export class RemoteInstallError extends Schema.TaggedError<RemoteInstallError>()(
  "RemoteInstallError",
  {
    alias: Schema.String,
    step: Schema.String,
    message: Schema.String,
  }
) {}

/**
 * Windows: the sign-in task this install would register runs another Polaris home
 * (`otherHome`, null when the task isn't Polaris'). `polaris install|upgrade` changed
 * nothing; the same command with `--replace-task` (`ApplyOptions.replaceTask`) takes it over.
 */
export class TaskConflict extends Schema.TaggedError<TaskConflict>()("TaskConflict", {
  alias: Schema.String,
  step: Schema.String,
  task: Schema.String,
  otherHome: Schema.NullOr(Schema.String),
  message: Schema.String,
}) {}

/** What `polaris install|upgrade --json` prints for a `TaskConflictError` (exit 3). */
const TaskConflictReport = Schema.Struct({
  ok: Schema.Literal(false),
  error: Schema.Literal("TaskConflictError"),
  message: Schema.String,
  task: Schema.String,
  otherHome: Schema.NullOr(Schema.String),
});

const decodeConflict = Schema.decodeUnknownOption(TaskConflictReport);

/** The report as a `TaskConflict`, when that is what it says; null for anything else. */
export const taskConflictOf = (
  report: Schema.JsonObject | null,
  where: { readonly alias: string; readonly step: string }
): TaskConflict | null =>
  Option.match(decodeConflict(report), {
    onNone: () => null,
    onSome: ({ task, otherHome, message }) =>
      new TaskConflict({ ...where, task, otherHome, message }),
  });

export const failed = (
  alias: string,
  step: string,
  result: { code: number; stderr: string; stdout: string }
) =>
  new RemoteInstallError({
    alias,
    step,
    message: `exit ${result.code}: ${(stripClixml(result.stderr) || result.stdout).trim()}`,
  });

export interface ApplyProgress {
  readonly stage: "downloading" | "uploading" | "switching";
  /** While downloading: on the Host itself, or on this machine before uploading. */
  readonly via?: "host" | "client";
  readonly bytes: number;
  readonly total: number;
}

/** Downloads a build that isn't bundled into this machine's cache, verified (`download.ts`). */
export type DownloadBuild = (
  build: DaemonBuild,
  onBytes: (bytes: number) => void
) => Effect.Effect<DaemonBuild, RemoteInstallError>;

export interface ApplyOptions {
  readonly progress?: ((value: ApplyProgress) => void) | undefined;
  /** Without it, a build that isn't bundled can only be downloaded by the Host. */
  readonly download?: DownloadBuild | undefined;
  /** This Client's version, sent with Host downloads for the site's telemetry. */
  readonly clientVersion?: string | undefined;
  /** How long the Host's download may take in all before falling back (default 15 minutes). */
  readonly hostFetchTimeoutMs?: number | undefined;
  /** Windows: take over a sign-in task another Polaris home holds (`--replace-task`). */
  readonly replaceTask?: boolean | undefined;
}

/** The JSON line `polaris install|upgrade --json` prints; its fields vary by action and version. */
export type DaemonReport = Schema.JsonObject;

export const decodeReport = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.JsonObject));

/**
 * Run `polaris install|upgrade --json` (`commandLine`, ready for the Host's shell) and
 * parse the JSON line it prints last.
 */
export const runPolaris = Effect.fn("runPolaris")(function* (
  alias: string,
  step: string,
  commandLine: string
) {
  const ssh = yield* Ssh;
  const result = yield* ssh.exec(alias, commandLine);
  const line = result.stdout.trim().split("\n").at(-1) ?? "";

  const report: DaemonReport | null = Option.getOrNull(decodeReport(line));

  const conflict = taskConflictOf(report, { alias, step });

  if (conflict !== null) return yield* conflict;

  if (result.code !== 0 || report === null || report.ok !== true) {
    const message = Predicate.isString(report?.message) ? report.message : null;

    return yield* message
      ? new RemoteInstallError({ alias, step, message })
      : failed(alias, step, result);
  }

  return report;
});

export type ApplyResult = Data.TaggedEnum<{
  Installed: { readonly version: string; readonly report: DaemonReport };
  Upgraded: { readonly from: string; readonly version: string; readonly report: DaemonReport };
}>;

export const ApplyResult = Data.taggedEnum<ApplyResult>();
