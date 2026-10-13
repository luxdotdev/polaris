/**
 * The window's title bar per platform, free of Electron so it is testable anywhere: macOS
 * (and Linux, unchanged) inset traffic lights; Windows' caption buttons over our own bar.
 */
import type { BrowserWindowConstructorOptions, TitleBarOverlayOptions } from "electron";
import type { ClientPlatform } from "../shared/platform.ts";

/** The renderer's title bar (shell/TitleBar.tsx, `h-11`), hairline included. */
export const TITLE_BAR_HEIGHT = 44;

/** The native caption buttons' width at 100% scale: three 46px buttons. */
export const CAPTION_BUTTONS_WIDTH = 138;

/**
 * Windows' caption buttons in the title bar's own tokens (`surface-sunken`, `text-default`),
 * one pixel short so the bar's hairline runs on beneath them without a seam.
 */
export const titleBarOverlay = (dark: boolean): TitleBarOverlayOptions => ({
  color: dark ? "#151618" : "#F3F3F5",
  symbolColor: dark ? "#E3E4E8" : "#333438",
  height: TITLE_BAR_HEIGHT - 1,
});

export const chromeOptions = (
  platform: ClientPlatform,
  dark: boolean
): BrowserWindowConstructorOptions =>
  platform === "win32"
    ? { titleBarStyle: "hidden", titleBarOverlay: titleBarOverlay(dark) }
    : {
        titleBarStyle: "hiddenInset",
        // Centred on the 44px title bar (Paper 1BC-0).
        trafficLightPosition: { x: 16, y: 15 },
      };

/** Where the app menu drops from on Windows: under the lockup (Paper W1). */
export const APP_MENU_ORIGIN = { x: 12, y: TITLE_BAR_HEIGHT } as const;

/** The fields of Electron's `before-input-event` input that the menu keys read. */
export interface MenuKeyInput {
  readonly type: string;
  readonly key: string;
  readonly alt: boolean;
  readonly control: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
}

/**
 * Windows' menu keys, with no menu bar to own them: F10, or Alt pressed and released alone.
 * `opens` is true for the input that should open the app menu; `reset` forgets a held Alt
 * (Alt+Tab away never delivers its key up here).
 */
export const menuKeys = () => {
  let altAlone = false;

  const reset = () => {
    altAlone = false;
  };

  const opens = (input: MenuKeyInput): boolean => {
    const others = input.control || input.shift || input.meta;

    if (input.type === "keyDown") {
      altAlone = input.key === "Alt" && !others;

      return input.key === "F10" && !others && !input.alt;
    }

    if (input.type === "keyUp" && input.key === "Alt" && altAlone) {
      altAlone = false;

      return true;
    }

    return false;
  };

  return { opens, reset };
};
