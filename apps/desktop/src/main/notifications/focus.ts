import { app, type BrowserWindow } from "electron";

/** Brings the window forward for a notification or the star: restored, shown, focused. */
export const focusWindow = (win: BrowserWindow | null) => {
  if (win === null) return;

  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  app.focus({ steal: true });
};
