/** Desktop App Updates, independent of a Host's Daemon Upgrades. */

/** The Release Polaris is downloading itself (docs/adr/0116). */
export interface AppUpdateDownload {
  readonly version: string;
  readonly receivedBytes: number;
  /** Null until the server says how large the Update is. */
  readonly totalBytes: number | null;
}

/** What went wrong last, in the user's terms; never upstream error text. */
export interface AppUpdateFailure {
  readonly stage: "check" | "download" | "verify";
  readonly version: string | null;
  /** How far a download got before the connection dropped. */
  readonly percent: number | null;
}

export interface AppUpdateView {
  readonly phase: "idle" | "checking" | "current" | "downloading" | "ready" | "blocked" | "failed";
  readonly version: string;
  /** The newest Release the last check found. */
  readonly availableVersion: string | null;
  /** The Release Squirrel has staged; it installs on restart or quit, whatever `phase` says. */
  readonly readyVersion: string | null;
  /** May name a newer Release than `readyVersion` while that one waits. */
  readonly download: AppUpdateDownload | null;
  readonly failure: AppUpdateFailure | null;
  readonly automatic: boolean;
  readonly lastCheckedAt: number | null;
  readonly installId: string;
  /** The Client OS's own version (macOS 26.1, Windows 10.0.26100), for About and the update feed. */
  readonly osVersion: string;
  readonly platform?: string;
  readonly arch: string;
  readonly supported: boolean;
}

const megabytes = (bytes: number) => Math.round(bytes / 1_000_000);

/** A download's share from 0 to 1, or null while its size is unknown. */
export const downloadFraction = (download: AppUpdateDownload): number | null =>
  download.totalBytes === null || download.totalBytes <= 0
    ? null
    : Math.min(1, download.receivedBytes / download.totalBytes);

/** A whole percent that says 100 only once every byte is here. */
export const downloadPercent = (fraction: number): number =>
  fraction >= 1 ? 100 : Math.min(99, Math.round(fraction * 100));

/** "48 of 131 MB · 37%", or "48 MB" while the size is unknown. */
export const downloadAmount = (download: AppUpdateDownload): string => {
  const fraction = downloadFraction(download);

  if (download.totalBytes === null || fraction === null)
    return `${megabytes(download.receivedBytes)} MB`;

  return `${megabytes(download.receivedBytes)} of ${megabytes(download.totalBytes)} MB · ${downloadPercent(fraction)}%`;
};

/** One line for the native menu and the K menu, which cannot draw a bar. */
export const downloadLine = (download: AppUpdateDownload): string =>
  `Downloading Polaris ${download.version} · ${downloadAmount(download)}`;
