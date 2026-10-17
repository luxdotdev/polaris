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
