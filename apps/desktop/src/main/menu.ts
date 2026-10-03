/**
 * The native menu: the standard macOS menus, plus Polaris → Settings… (⌘,),
 * View, Go, Session and Help built from the keymap (`shared/keymap.ts`). Their
 * accelerators are shown but not registered, so key presses reach the
 * renderer, the one place that handles shortcuts; a menu click sends the command there.
 */
import { BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";
import {
  type AppEvent,
  type Appearance,
  CHANNELS,
  type Density,
  type ThemeSource,
} from "../shared/api.ts";
import { isBare, parseChord } from "../shared/chord.ts";
import { KEYMAP, type MenuName } from "../shared/keymap.ts";
import type { AppUpdateView } from "../shared/appUpdates.ts";

export interface MenuInput {
  readonly appearance: Appearance;
  readonly setAppearance: (patch: Partial<Appearance>) => void;
  readonly dev: boolean;
  /** The local Host runs the bench Harness: offer Develop → Start proof session. */
  readonly proofHostKey: string | null;
  readonly updates: AppUpdateView;
  readonly checkUpdates: () => void;
  readonly restartToUpdate: () => void;
}

/** To the focused window, else the first (a hidden window, in smoke tests, is never focused). */
const send = (event: AppEvent) =>
  (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])?.webContents.send(
    CHANNELS.app,
    event
  );

/** A menu's items from the keymap; the first chord with a modifier is the one shown. */
const commandItems = (menu: MenuName): Array<MenuItemConstructorOptions> =>
  KEYMAP.filter((b) => b.menu === menu).map((b) => {
    const shown = b.keys.find((k) => !isBare(parseChord(k)));

    const item: MenuItemConstructorOptions = {
      id: b.id,
      label: b.title,
      click: () => send({ kind: "command", id: b.id }),
    };

    if (shown !== undefined) {
      item.accelerator = shown;
      item.registerAccelerator = false;
    }

    return item;
  });

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

/** The macOS app menu, as `role: "appMenu"` builds it, plus the keymap's App items (Settings…). */
const appMenu = (input: MenuInput): MenuItemConstructorOptions => ({
  role: "appMenu",
  submenu: [
    { label: "About Polaris", click: () => send({ kind: "command", id: "settings.about" }) },
    updateMenuItem(input),
    { type: "separator" },
    ...commandItems("App"),
    { type: "separator" },
    { role: "services" },
    { type: "separator" },
    { role: "hide" },
    { role: "hideOthers" },
    { role: "unhide" },
    { type: "separator" },
    { role: "quit", label: input.updates.phase === "ready" ? "Quit and update" : "Quit Polaris" },
  ],
});

export const updateMenuItem = (
  input: Pick<MenuInput, "updates" | "checkUpdates" | "restartToUpdate">
): MenuItemConstructorOptions => {
  const ready = input.updates.phase === "ready";

  return {
    label: ready
      ? `Restart to update${input.updates.availableVersion === null ? "" : ` to ${input.updates.availableVersion}`}`
      : "Check for updates…",
    enabled:
      ready ||
      (input.updates.supported &&
        !["checking", "downloading", "blocked"].includes(input.updates.phase)),
    click: ready ? input.restartToUpdate : input.checkUpdates,
  };
};

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

export const buildMenu = (input: MenuInput) => {
  const { appearance, setAppearance, dev, proofHostKey } = input;

  const view: Array<MenuItemConstructorOptions> = [
    ...commandItems("View"),
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
      appMenu(input),
      { role: "fileMenu" },
      { role: "editMenu" },
      { label: "View", submenu: view },
      { label: "Go", submenu: commandItems("Go") },
      { label: "Session", submenu: commandItems("Session") },
      { role: "windowMenu" },
      ...(dev || proofHostKey !== null ? [develop(proofHostKey)] : []),
      { role: "help", submenu: commandItems("Help") },
    ])
  );
};
