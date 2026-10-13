/** Desktop App Updates, independent of a Host's Daemon Upgrades. */
export interface AppUpdateView {
  readonly phase: "idle" | "checking" | "current" | "downloading" | "ready" | "blocked" | "failed";
  readonly version: string;
  readonly availableVersion: string | null;
  readonly automatic: boolean;
  readonly lastCheckedAt: number | null;
  readonly installId: string;
  /** The Client OS's own version (macOS 26.1, Windows 10.0.26100), for About and the update feed. */
  readonly osVersion: string;
  readonly platform?: string;
  readonly arch: string;
  readonly supported: boolean;
}
