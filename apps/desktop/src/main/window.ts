/**
 * The single main window: `hiddenInset` title bar with native traffic lights,
 * hardened web preferences, and no navigation away from the app.
 */
import { BrowserWindow, nativeTheme, shell } from "electron";

export interface MainWindowInput {
  readonly url: string;
  readonly preload: string;
  readonly trusted: (url: string) => boolean;
  /** Smoke tests and benchmarks keep the window hidden. */
  readonly show: boolean;
}

/** DESIGN.md `bg-dark` / `bg-light`, so the first frame matches the theme. */
export const windowBackground = () => (nativeTheme.shouldUseDarkColors ? "#1A1B1D" : "#FBFBFC");

export const createMainWindow = ({ url, preload, trusted, show }: MainWindowInput) => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 760,
    minHeight: 480,
    show: false,
    title: "Polaris",
    backgroundColor: windowBackground(),
    titleBarStyle: "hiddenInset",
    // Centred on the 44px title bar (Paper 1BC-0).
    trafficLightPosition: { x: 16, y: 15 },
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      v8CacheOptions: "bypassHeatCheck",
    },
  });

  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith("https://")) void shell.openExternal(target);

    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, target) => {
    if (!trusted(target)) event.preventDefault();
  });
  nativeTheme.on("updated", () => {
    if (!win.isDestroyed()) win.setBackgroundColor(windowBackground());
  });

  if (show) win.once("ready-to-show", () => win.show());
  void win.loadURL(url);

  return win;
};
