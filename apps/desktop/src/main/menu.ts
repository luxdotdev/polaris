/**
 * The native menu: the standard macOS menus with Polaris → Settings… (⌘,),
 * View → Orchestrate / Review / Edit (⌘1–3, routed in the renderer), and the
 * appearance and density overrides.
 */
import { BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";
import {
  type AppEvent,
  type Appearance,
  CHANNELS,
  type Density,
  type Route,
  type ThemeSource,
} from "../shared/api.ts";

export interface MenuInput {
  readonly appearance: Appearance;
  readonly setAppearance: (patch: Partial<Appearance>) => void;
  readonly dev: boolean;
  /** The local Host runs the bench Harness: offer Develop → Start proof session. */
  readonly proofHostKey: string | null;
}

/** To the focused window, else the first (a hidden window, in smoke tests, is never focused). */
const send = (event: AppEvent) =>
  (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])?.webContents.send(
    CHANNELS.app,
    event
  );

const develop = (proofHostKey: string | null): MenuItemConstructorOptions => ({
  label: "Develop",
  submenu: [
    {
      id: "dev-proof",
      label: "Start proof session",
      enabled: proofHostKey !== null,
      click: () => {
        if (proofHostKey !== null) send({ kind: "proof", hostKey: proofHostKey });
      },
    },
    { type: "separator" },
    { role: "reload" },
    { role: "toggleDevTools" },
  ],
});

/** The macOS app menu, as `role: "appMenu"` builds it, plus Settings… (⌘,). */
const appMenu: MenuItemConstructorOptions = {
  role: "appMenu",
  submenu: [
    { role: "about" },
    { type: "separator" },
    {
      id: "settings",
      label: "Settings…",
      accelerator: "CmdOrCtrl+,",
      click: () => send({ kind: "settings" }),
    },
    { type: "separator" },
    { role: "services" },
    { type: "separator" },
    { role: "hide" },
    { role: "hideOthers" },
    { role: "unhide" },
    { type: "separator" },
    { role: "quit" },
  ],
};

const route = (to: Route) => () => send({ kind: "route", route: to });

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

const DENSITIES: ReadonlyArray<{ readonly label: string; readonly density: Density }> = [
  { label: "Calm", density: "calm" },
  { label: "Balanced", density: "balanced" },
  { label: "Compact", density: "compact" },
];

export const buildMenu = ({ appearance, setAppearance, dev, proofHostKey }: MenuInput) => {
  const view: Array<MenuItemConstructorOptions> = [
    ...MODES.map((m) => ({ label: m.label, accelerator: m.key, click: route(m.route) })),
    { type: "separator" },
    {
      label: "Appearance",
      submenu: THEMES.map((t) => ({
        label: t.label,
        type: "radio" as const,
        checked: t.theme === appearance.theme,
        click: () => setAppearance({ theme: t.theme }),
      })),
    },
    {
      label: "Density",
      submenu: DENSITIES.map((d) => ({
        label: d.label,
        type: "radio" as const,
        checked: d.density === appearance.density,
        click: () => setAppearance({ density: d.density }),
      })),
    },
    { type: "separator" },
    { role: "togglefullscreen" },
  ];

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      appMenu,
      { role: "fileMenu" },
      { role: "editMenu" },
      { label: "View", submenu: view },
      { role: "windowMenu" },
      ...(dev || proofHostKey !== null ? [develop(proofHostKey)] : []),
    ])
  );
};
