/**
 * The native menu: the standard macOS menus, View → Orchestrate / Review /
 * Edit (⌘1–3, routed in the renderer) and the appearance override.
 */
import { BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";
import { CHANNELS, type MenuCommand, type Route, type ThemeSource } from "../shared/api.ts";

export interface MenuInput {
  readonly theme: ThemeSource;
  readonly setTheme: (theme: ThemeSource) => void;
  readonly dev: boolean;
}

const route = (to: Route) => () => {
  const command: MenuCommand = { route: to };

  BrowserWindow.getFocusedWindow()?.webContents.send(CHANNELS.menu, command);
};

const MODES: ReadonlyArray<{
  readonly label: string;
  readonly route: Route;
  readonly key: string;
}> = [
  { label: "Orchestrate", route: "orchestrate", key: "CmdOrCtrl+1" },
  { label: "Review", route: "review", key: "CmdOrCtrl+2" },
  { label: "Edit", route: "edit", key: "CmdOrCtrl+3" },
];

const THEMES: ReadonlyArray<{ readonly label: string; readonly theme: ThemeSource }> = [
  { label: "System", theme: "system" },
  { label: "Dark", theme: "dark" },
  { label: "Light", theme: "light" },
];

export const buildMenu = ({ theme, setTheme, dev }: MenuInput) => {
  const view: Array<MenuItemConstructorOptions> = [
    ...MODES.map((m) => ({ label: m.label, accelerator: m.key, click: route(m.route) })),
    { type: "separator" },
    {
      label: "Appearance",
      submenu: THEMES.map((t) => ({
        label: t.label,
        type: "radio" as const,
        checked: t.theme === theme,
        click: () => setTheme(t.theme),
      })),
    },
    { type: "separator" },
    { role: "togglefullscreen" },
  ];

  if (dev) view.push({ type: "separator" }, { role: "reload" }, { role: "toggleDevTools" });

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      { role: "fileMenu" },
      { role: "editMenu" },
      { label: "View", submenu: view },
      { role: "windowMenu" },
    ])
  );
};
