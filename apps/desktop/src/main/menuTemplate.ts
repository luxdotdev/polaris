/**
 * The native menu's template, free of Electron so each platform's is testable anywhere.
 * macOS (and Linux, unchanged) get the standard app menu; Windows gets File … Help, with
 * Settings… and Exit in File and About in Help (Paper W1), popped up from the lockup.
 */
import type { MenuItemConstructorOptions } from "electron";
import type { AppEvent, Appearance, Density, ThemeSource } from "../shared/api.ts";
import { isBare, parseChord } from "../shared/chord.ts";
import { KEYMAP, type MenuName } from "../shared/keymap.ts";
import type { AppUpdateView } from "../shared/appUpdates.ts";
import type { ClientPlatform } from "../shared/platform.ts";

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

export interface TemplateInput extends MenuInput {
  readonly platform: ClientPlatform;
  /** To the renderer, the one place that handles commands. */
  readonly send: (event: AppEvent) => void;
}

type Items = Array<MenuItemConstructorOptions>;

/** A menu's items from the keymap; the first chord with a modifier is the one shown. */
const commandItems = (menu: MenuName, send: TemplateInput["send"]): Items =>
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

const develop = ({ proofHostKey, send }: TemplateInput): MenuItemConstructorOptions => ({
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

const about = (send: TemplateInput["send"]): MenuItemConstructorOptions => ({
  label: "About Polaris",
  click: () => send({ kind: "command", id: "settings.about" }),
});

/** The macOS app menu, as `role: "appMenu"` builds it, plus the keymap's App items (Settings…). */
const appMenu = (input: TemplateInput): MenuItemConstructorOptions => ({
  role: "appMenu",
  submenu: [
    about(input.send),
    updateMenuItem(input),
    { type: "separator" },
    ...commandItems("App", input.send),
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

const viewItems = ({ appearance, setAppearance, send }: TemplateInput): Items => [
  ...commandItems("View", send),
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

const developMenu = (input: TemplateInput): Items =>
  input.dev || input.proofHostKey !== null ? [develop(input)] : [];

const macTemplate = (input: TemplateInput): Items => [
  appMenu(input),
  { label: "File", submenu: commandItems("File", input.send) },
  { role: "editMenu" },
  { label: "View", submenu: viewItems(input) },
  { label: "Go", submenu: commandItems("Go", input.send) },
  { label: "Session", submenu: commandItems("Session", input.send) },
  { role: "windowMenu" },
  ...developMenu(input),
  { role: "help", submenu: commandItems("Help", input.send) },
];

/** Windows has no app menu or Window menu: Settings… and Exit end File, About ends Help. */
const windowsTemplate = (input: TemplateInput): Items => [
  {
    label: "&File",
    submenu: [
      ...commandItems("File", input.send),
      { type: "separator" },
      ...commandItems("App", input.send),
      { type: "separator" },
      { role: "quit", label: input.updates.phase === "ready" ? "Exit and update" : "Exit" },
    ],
  },
  { role: "editMenu", label: "&Edit" },
  { label: "&View", submenu: viewItems(input) },
  { label: "&Go", submenu: commandItems("Go", input.send) },
  { label: "&Session", submenu: commandItems("Session", input.send) },
  ...developMenu(input),
  {
    label: "&Help",
    submenu: [
      ...commandItems("Help", input.send),
      { type: "separator" },
      updateMenuItem(input),
      about(input.send),
    ],
  },
];

export const menuTemplate = (input: TemplateInput): Items =>
  input.platform === "win32" ? windowsTemplate(input) : macTemplate(input);
