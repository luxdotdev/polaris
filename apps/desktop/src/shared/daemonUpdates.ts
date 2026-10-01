/** Update progress travels on the existing `machines` feed, including for this Mac. */
export interface DaemonUpdateProgress {
  readonly stage: "checking" | "uploading" | "switching" | "done" | "failed";
  readonly bytes: number;
  readonly total: number;
}

export interface DaemonUpdateResult {
  readonly at: number;
  readonly result: "updated" | "current" | "newer" | "failed";
  readonly from: string | null;
  readonly version: string | null;
  readonly problem: {
    readonly kind: "unsupported" | "missing-build" | "host-setup" | "ssh" | "failed";
    readonly message: string;
    readonly command: string | null;
    readonly sshFailure: "host-key" | "auth" | "unreachable" | "spawn" | "unknown" | null;
  } | null;
}

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
