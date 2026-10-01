/**
 * Polaris's name and icon wherever the OS shows them: the app menu, About, the Dock and the
 * window list. Packaged, Info.plist and the bundle's icon do most of it. In dev the binary is
 * `Polaris Dev.app` on macOS (scripts/lib/devBundle.ts), and the Dock shows the dusk icon.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

export const APP_NAME = "Polaris";

export interface IconPaths {
  /** The repository root, for `design/assets/app-icon` in dev. */
  readonly repoRoot: string;
}

/** The app icon as a PNG: the bundled copy when packaged, else dev's dusk icon from the repo. */
export const iconPng = ({ repoRoot }: IconPaths): string | null => {
  const icons = join(repoRoot, "design/assets/app-icon");

  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "icon.png")]
    : [join(icons, "dusk/icon-1024.png"), join(icons, "icon-1024.png")];

  return candidates.find((path) => existsSync(path)) ?? null;
};

/** Call before `ready`: the app menu's title and About read the name then. */
export const nameApp = () => {
  // Renaming can move userData; keep settings where they already are.
  const userData = app.getPath("userData");

  app.setName(APP_NAME);
  app.setPath("userData", userData);
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    copyright: "© 2026 lux.dev LLC",
    website: "https://lux.dev",
  });
};

/** After `ready`: the dev Dock shows the dusk icon, whatever binary runs it. */
export const showIcon = (paths: IconPaths) => {
  const icon = iconPng(paths);

  if (icon === null || app.isPackaged) return;
  app.dock?.setIcon(icon);
};
