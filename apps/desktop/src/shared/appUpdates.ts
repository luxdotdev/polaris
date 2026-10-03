/** Desktop App Updates, independent of a Host's Daemon Upgrades. */
export interface AppUpdateView {
  readonly phase: "idle" | "checking" | "current" | "downloading" | "ready" | "blocked" | "failed";
  readonly version: string;
  readonly availableVersion: string | null;
  readonly automatic: boolean;
  readonly lastCheckedAt: number | null;
  readonly installId: string;
  readonly macOSVersion: string;
  readonly arch: string;
  readonly supported: boolean;
}
