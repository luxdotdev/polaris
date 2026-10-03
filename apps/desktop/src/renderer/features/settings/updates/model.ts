/** Reachable update-row copy from DESIGN.md, Updates (U1–U3). */
import type { AppUpdateView } from "../../../../shared/appUpdates.ts";

export interface AppUpdateRow {
  readonly title: string;
  readonly caption: string;
  readonly glyph: "working" | "check" | "star" | "folder" | "failed" | "off";
  readonly action: "check" | "restart" | "finder" | null;
  readonly actionLabel: string;
}

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
): AppUpdateRow => ({ title, caption, glyph, action: "check", actionLabel: "Check now" });

export const appUpdateRow = (view: AppUpdateView): AppUpdateRow => {
  const release = view.availableVersion === null ? "Polaris" : `Polaris ${view.availableVersion}`;

  switch (view.phase) {
    case "checking":
      return {
        title: "Checking for updates…",
        caption: "Asking polaris.lux.dev for the latest release",
        glyph: "working",
        action: null,
        actionLabel: "",
      };
    case "downloading":
      return {
        title: `Downloading ${release}`,
        caption: "In the background · nothing to do yet",
        glyph: "working",
        action: null,
        actionLabel: "",
      };
    case "ready":
      return {
        title: `${release} is ready`,
        caption: "Installs when you restart or quit; agent sessions keep working",
        glyph: "star",
        action: "restart",
        actionLabel: "Restart to update",
      };
    case "blocked":
      return {
        title: `${release} can't install here`,
        caption: "Move Polaris to Applications, then check again",
        glyph: "folder",
        action: "finder",
        actionLabel: "Show in Finder",
      };
    case "failed":
      return {
        title: "Couldn't check for updates",
        caption: `polaris.lux.dev didn't answer · ${view.automatic ? "tries again in 6 hours" : "check again when you're ready"}`,
        glyph: "failed",
        action: "check",
        actionLabel: "Try again",
      };
    case "idle":
    case "current":
      if (!view.supported)
        return checkRow(
          "Updates are available in the installed Mac app",
          "This build doesn't check the update feed",
          "off"
        );

      if (!view.automatic)
        return checkRow(
          "Automatic checks are off",
          `Last checked: ${checkedAt(view.lastCheckedAt)}`,
          "off"
        );

      return checkRow(
        view.phase === "current" ? "Polaris is up to date" : "Check for a new release",
        view.lastCheckedAt === null
          ? "Polaris downloads updates in the background"
          : `${view.version} is the latest release · checked ${checkedAt(view.lastCheckedAt)}`
      );
  }
};
