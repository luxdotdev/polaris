/** Reachable update-row copy from DESIGN.md, Updates (U1–U3). */
import { clientCopy } from "../../../../shared/clientCopy.ts";
import type { ContextValue } from "../../../../shared/keymap.ts";
import { clientPlatform } from "../../../../shared/platform.ts";
import {
  downloadAmount,
  downloadFraction,
  downloadLine,
  type AppUpdateFailure,
  type AppUpdateView,
} from "../../../../shared/appUpdates.ts";

export interface AppUpdateRow {
  readonly title: string;
  readonly caption: string;
  /** Checking: the trailing spinner (Paper U1). */
  readonly spinner: boolean;
  readonly action: "check" | "restart" | "finder" | null;
  readonly actionLabel: string;
  /** The download's bar: "48 of 131 MB · 37%", and its share once the size is known. */
  readonly progress: { readonly amount: string; readonly fraction: number | null } | null;
  /** Only a failed download takes the failed colour (Paper U1). */
  readonly tone: "default" | "failed";
}

const QUIET = { progress: null, tone: "default", spinner: false } as const;

export const checkedAt = (at: number | null): string =>
  at === null
    ? "Not checked yet"
    : new Date(at).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

const checkRow = (title: string, caption: string): AppUpdateRow => ({
  title,
  caption,
  action: "check",
  actionLabel: "Check now",
  ...QUIET,
});

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

/** "Checked today at 14:02" (Paper U1), or the date for an older check. */
export const checkedCaption = (at: number, now: number): string => {
  const day = new Date(at);

  return day.toDateString() === new Date(now).toDateString()
    ? `Checked today at ${clock(at)}`
    : `Checked ${day.toLocaleDateString([], { month: "short", day: "numeric" })} at ${clock(at)}`;
};

const named = (version: string | null) => (version === null ? "Polaris" : `Polaris ${version}`);

/** Squirrel went quiet with the Update: nothing can be handed to it again until a restart. */
const failedInstall = (failure: AppUpdateFailure): AppUpdateRow => ({
  title: `Couldn't install ${named(failure.version)}`,
  caption: "The installer didn't answer; restart Polaris to try again",
  action: null,
  actionLabel: "",
  progress: null,
  tone: "failed",
  spinner: false,
});

/** A download that failed: what happened, then that the next check tries again. */
const failedDownload = (failure: AppUpdateFailure): AppUpdateRow => {
  if (failure.stage === "install") return failedInstall(failure);

  const what =
    failure.stage === "verify"
      ? "The download didn't pass verification"
      : failure.percent === null
        ? "The connection dropped"
        : `The connection dropped at ${failure.percent}%`;

  return {
    title: `Couldn't download ${named(failure.version)}`,
    caption: `${what}; Polaris tries again on the next check`,
    action: "check",
    actionLabel: "Try again",
    progress: null,
    tone: "failed",
    spinner: false,
  };
};

/** Paper U1: why this Release and not the one before it. */
const downloadingCaption = (view: AppUpdateView, version: string | null) => {
  if (view.replaces != null && version !== null)
    return `${version} came out, so it replaces ${view.replaces}`;

  if (view.skipped != null) return `The newest release; ${view.skipped} is skipped`;

  return "In the background · nothing to do yet";
};

const downloading = (view: AppUpdateView): AppUpdateRow => {
  const download = view.download;
  const fraction = download === null ? null : downloadFraction(download);
  const version = download?.version ?? view.availableVersion;

  return {
    title: `Downloading ${named(version)}`,
    // Full, but Squirrel is still checking and unpacking it.
    caption: fraction === 1 ? "Verifying the download" : downloadingCaption(view, version),
    action: null,
    actionLabel: "",
    progress: download === null ? null : { amount: downloadAmount(download), fraction },
    tone: "default",
    spinner: false,
  };
};

/** One row per state, as Paper "Polaris — 0.11.0" U1 draws them. */
export const appUpdateRow = (view: AppUpdateView, now: number = Date.now()): AppUpdateRow => {
  const release = named(view.availableVersion);

  const copy = platformCopy(view.platform);

  switch (view.phase) {
    case "checking":
      return {
        title: "Checking for updates…",
        caption: "Asking polaris.lux.dev for the latest release",
        action: null,
        actionLabel: "",
        ...QUIET,
        spinner: true,
      };
    case "downloading":
      return downloading(view);
    case "ready":
      return {
        title: `${named(view.readyVersion ?? view.availableVersion)} is ready`,
        caption: "Installs when you restart or quit; agent sessions keep working",
        action: "restart",
        actionLabel: "Restart to update",
        ...QUIET,
      };
    case "blocked":
      return {
        title: `${release} can't install here`,
        caption: copy.install,
        action: "finder",
        actionLabel: copy.reveal,
        ...QUIET,
      };
    case "failed":
      if (view.failure !== null && view.failure.stage !== "check")
        return failedDownload(view.failure);

      return {
        title: "Couldn't check for updates",
        caption: `polaris.lux.dev didn't answer · ${view.automatic ? "tries again in 6 hours" : "check again when you're ready"}`,
        action: "check",
        actionLabel: "Try again",
        ...QUIET,
      };
    case "idle":
    case "current":
      if (!view.supported)
        return checkRow(copy.unsupported, "This build doesn't check the update feed");

      if (!view.automatic) return checkRow("Automatic checks are off", `You're on ${view.version}`);

      if (view.phase === "idle" || view.lastCheckedAt === null)
        return checkRow("Check for a new release", "Polaris downloads updates in the background");

      return checkRow(
        `Polaris ${view.version} is up to date`,
        checkedCaption(view.lastCheckedAt, now)
      );
  }
};

/** The update's platform, as main reports it; the Client's own when it doesn't say. */
const platformCopy = (platform: string = clientPlatform()) => {
  const reveal = clientCopy(platform).showApp;

  return platform === "win32"
    ? {
        install: "Install Polaris with Setup.exe, then check again",
        reveal,
        unsupported: "Updates are available in the installed Windows app",
      }
    : {
        install: "Move Polaris to Applications, then check again",
        reveal,
        unsupported: "Updates are available in the installed Mac app",
      };
};

/** What the K menu's update rows say: the staged version, and a download's progress line. */
export const updateValues = (view: AppUpdateView | null) => {
  const values: Partial<Record<ContextValue, string>> = {};

  if (view?.readyVersion != null) values.updateVersion = view.readyVersion;

  if (view?.phase === "downloading" && view.download !== null)
    values.updateProgress = downloadLine(view.download);

  return values;
};
