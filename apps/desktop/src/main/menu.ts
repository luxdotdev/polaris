/**
 * The native menu (menuTemplate.ts): the standard macOS menus, or Windows' File … Help.
 * Their accelerators come from the keymap and are shown but not registered, so key presses
 * reach the renderer, the one place that handles shortcuts; a menu click sends the command there.
 */
import { BrowserWindow, Menu } from "electron";
import { type AppEvent, CHANNELS } from "../shared/api.ts";
import { clientPlatform } from "../shared/platform.ts";
import { APP_MENU_ORIGIN } from "./chrome.ts";
import { type MenuInput, menuTemplate } from "./menuTemplate.ts";

export { type MenuInput, updateMenuItem } from "./menuTemplate.ts";

/** To the focused window, else the first (a hidden window, in smoke tests, is never focused). */
const send = (event: AppEvent) =>
  (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])?.webContents.send(
    CHANNELS.app,
    event
  );

export const buildMenu = (input: MenuInput) => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(menuTemplate({ ...input, platform: clientPlatform(), send }))
  );
};

/** Windows: the whole menu drops from the title bar's lockup (Paper W1). */
export const popupAppMenu = (win: BrowserWindow) => {
  Menu.getApplicationMenu()?.popup({ window: win, ...APP_MENU_ORIGIN });
};
