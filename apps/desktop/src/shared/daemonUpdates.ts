import { Schema } from "effect";

export const DaemonUpdateResultSchema = Schema.Struct({
  at: Schema.Number,
  result: Schema.Literals(["updated", "current", "newer", "failed"]),
  from: Schema.NullOr(Schema.String),
  version: Schema.NullOr(Schema.String),
  problem: Schema.NullOr(
    Schema.Struct({
      kind: Schema.Literals(["unsupported", "missing-build", "host-setup", "ssh", "failed"]),
      message: Schema.String,
      command: Schema.NullOr(Schema.String),
      sshFailure: Schema.NullOr(
        Schema.Literals(["host-key", "auth", "unreachable", "spawn", "unknown"])
      ),
    })
  ),
});

/** Update progress travels on the existing `machines` feed, including for this Mac. */
export interface DaemonUpdateProgress {
  readonly stage: "checking" | "uploading" | "switching" | "done" | "failed";
  readonly bytes: number;
  readonly total: number;
}

export type DaemonUpdateResult = typeof DaemonUpdateResultSchema.Type;

export interface DaemonUpdateView {
  /** False for the app's own dev Daemon or an unmanaged socket. */
  readonly managed: boolean;
  readonly installedVersion: string | null;
  readonly bundledVersion: string | null;
  readonly updateAvailable: boolean;
  /** App-wide default; absent persisted settings mean true. */
  readonly keepDaemonsUpToDate: boolean;
  /** Null inherits the app-wide default. */
  readonly keepUpToDateOverride: boolean | null;
  readonly keepUpToDate: boolean;
  readonly progress: DaemonUpdateProgress | null;
  readonly lastUpdate: DaemonUpdateResult | null;
}
