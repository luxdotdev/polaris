/**
 * The needs-you count on the app's icon: the Dock badge on macOS, the taskbar button's
 * overlay on Windows (Paper W2: 1–9, then 9+, cleared at zero, never flashing).
 */
import { app, type BrowserWindow, nativeTheme } from "electron";
import { clientPlatform } from "../../shared/platform.ts";
import { badgeText, taskbarBadge } from "../tray/pixels.ts";
import { imageAt } from "../tray/star.ts";

export const showBadge = (win: BrowserWindow | null, count: number) => {
  app.dock?.setBadge(count > 0 ? String(count) : "");

  if (clientPlatform() !== "win32" || win === null) return;
  const text = badgeText(count);

  if (text === null) {
    win.setOverlayIcon(null, "");

    return;
  }

  const dark = nativeTheme.shouldUseDarkColorsForSystemIntegratedUI;

  win.setOverlayIcon(
    imageAt((scale) => taskbarBadge(scale, text, dark)),
    `${count} need you`
  );
};
