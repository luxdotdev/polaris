/** Settings in the K menu: "Settings" (⌘,) and one action per section. */
import { registerActions, type ShellAction } from "../../routes/actions.ts";
import type { ShellActions } from "../../routes/navigation.ts";
import { SECTIONS } from "./model/sections.ts";

export const settingsActions = (shell: ShellActions): ReadonlyArray<ShellAction> => [
  {
    id: "settings.open",
    title: "Settings",
    group: "Settings",
    keywords: ["preferences"],
    shortcut: "⌘,",
    run: () => shell.openSettings(),
  },
  ...SECTIONS.map((section): ShellAction => ({
    id: `settings.${section.id}`,
    title: `Settings: ${section.title}`,
    group: "Settings",
    keywords: section.keywords,
    run: () => shell.openSettings(section.id),
  })),
];

export const registerSettingsActions = (shell: ShellActions) =>
  registerActions(settingsActions(shell));
