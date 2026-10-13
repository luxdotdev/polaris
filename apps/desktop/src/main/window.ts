/**
 * The single main window: the platform's title bar (chrome.ts), hardened web preferences,
 * and no navigation away from the app.
 */
import { BrowserWindow, nativeTheme, shell } from "electron";
import { clientPlatform, PLATFORM_ARG } from "../shared/platform.ts";
import { chromeOptions, menuKeys, titleBarOverlay, WM_ENTERMENULOOP } from "./chrome.ts";
import { popupAppMenu } from "./menu.ts";

export interface MainWindowInput {
  readonly url: string;
  readonly preload: string;
  readonly trusted: (url: string) => boolean;
  /** Smoke tests and benchmarks keep the window hidden. */
  readonly show: boolean;
  /** Linux's window list and dock take the icon from the window; macOS uses the bundle's. */
  readonly icon: string | null;
}

/** DESIGN.md `bg-dark` / `bg-light`, so the first frame matches the theme. */
export const windowBackground = () => (nativeTheme.shouldUseDarkColors ? "#1A1B1D" : "#FBFBFC");

export const createMainWindow = ({ url, preload, trusted, show, icon }: MainWindowInput) => {
  const platform = clientPlatform();

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 760,
    minHeight: 480,
    show: false,
    title: "Polaris",
    backgroundColor: windowBackground(),
    ...chromeOptions(platform, nativeTheme.shouldUseDarkColors),
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      v8CacheOptions: "bypassHeatCheck",
      additionalArguments: [`${PLATFORM_ARG}${platform}`],
    },
  });

  if (platform === "linux" && icon !== null) win.setIcon(icon);

  if (platform === "win32") {
    const keys = menuKeys();

    // The menu bar stays hidden; F10 or a lone Alt drops the menu from the lockup instead.
    win.setMenuBarVisibility(false);
    win.webContents.on("before-input-event", (event, input) => {
      if (!keys.opens(input)) return;
      event.preventDefault();
      popupAppMenu(win);
    });
    win.on("blur", keys.reset);
    win.hookWindowMessage(WM_ENTERMENULOOP, keys.reset);
  }

  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith("https://")) void shell.openExternal(target);

    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, target) => {
    if (!trusted(target)) event.preventDefault();
  });
  // Appearance changes set themeSource, which lands here: the overlay follows the bar.
  nativeTheme.on("updated", () => {
    if (win.isDestroyed()) return;
    win.setBackgroundColor(windowBackground());

    if (platform === "win32") {
      win.setTitleBarOverlay(titleBarOverlay(nativeTheme.shouldUseDarkColors));
    }
  });

  if (show) win.once("ready-to-show", () => win.show());
  void win.loadURL(url);

  return win;
};
