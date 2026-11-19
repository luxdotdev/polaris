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
  readonly glyph: "working" | "check" | "star" | "folder" | "failed" | "off";
  readonly action: "check" | "restart" | "finder" | null;
  readonly actionLabel: string;
  /** The download's bar: "48 of 131 MB · 37%", and its share once the size is known. */
  readonly progress: { readonly amount: string; readonly fraction: number | null } | null;
  /** Only a failed download takes the failed colour (Paper U1). */
  readonly tone: "default" | "failed";
}

const QUIET = { progress: null, tone: "default" } as const;

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

const checkRow = (
  title: string,
  caption: string,
  glyph: AppUpdateRow["glyph"] = "check"
): AppUpdateRow => ({ title, caption, glyph, action: "check", actionLabel: "Check now", ...QUIET });

const named = (version: string | null) => (version === null ? "Polaris" : `Polaris ${version}`);

/** A download that failed: what happened, then that the next check tries again. */
const failedDownload = (failure: AppUpdateFailure): AppUpdateRow => {
  const what =
    failure.stage === "verify"
      ? "The download didn't pass verification"
      : failure.percent === null
        ? "The connection dropped"
        : `The connection dropped at ${failure.percent}%`;

  return {
    title: `Couldn't download ${named(failure.version)}`,
    caption: `${what}; Polaris tries again on the next check`,
    glyph: "failed",
    action: "check",
    actionLabel: "Try again",
    progress: null,
    tone: "failed",
  };
};

const downloading = (view: AppUpdateView): AppUpdateRow => {
  const download = view.download;
  const fraction = download === null ? null : downloadFraction(download);

  return {
    title: `Downloading ${named(download?.version ?? view.availableVersion)}`,
    // Full, but Squirrel is still checking and unpacking it.
    caption: fraction === 1 ? "Verifying the download" : "In the background · nothing to do yet",
    glyph: "working",
    action: null,
    actionLabel: "",
    progress: download === null ? null : { amount: downloadAmount(download), fraction },
    tone: "default",
  };
};

/** The row's caption never repeats when it checked: the card's footer carries that (SR-12). */
export const appUpdateRow = (view: AppUpdateView): AppUpdateRow => {
  const release = named(view.availableVersion);

  const copy = platformCopy(view.platform);

  switch (view.phase) {
    case "checking":
      return {
        title: "Checking for updates…",
        caption: "Asking polaris.lux.dev for the latest release",
        glyph: "working",
        action: null,
        actionLabel: "",
        ...QUIET,
      };
    case "downloading":
      return downloading(view);
    case "ready":
      return {
        title: `${named(view.readyVersion ?? view.availableVersion)} is ready`,
        caption: "Installs when you restart or quit; agent sessions keep working",
        glyph: "star",
        action: "restart",
        actionLabel: "Restart to update",
        ...QUIET,
      };
    case "blocked":
      return {
        title: `${release} can't install here`,
        caption: copy.install,
        glyph: "folder",
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
        glyph: "failed",
        action: "check",
        actionLabel: "Try again",
        ...QUIET,
      };
    case "idle":
    case "current":
      if (!view.supported)
        return checkRow(copy.unsupported, "This build doesn't check the update feed", "off");

      if (!view.automatic)
        return checkRow("Automatic checks are off", `You're on ${view.version}`, "off");

      return checkRow(
        view.phase === "current" ? "Polaris is up to date" : "Check for a new release",
        view.lastCheckedAt === null
          ? "Polaris downloads updates in the background"
          : `${view.version} is the latest release`
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
