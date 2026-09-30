/**
 * Settings (DESIGN.md, Settings): the frame that replaces the three zones
 * (⌘,, the sidebar's gear, the K menu), Appearance, Harnesses and Usage.
 * Hosts is the `SettingsHosts` slot, filled by features/machines.
 */
export { settingsCommands } from "./actions.ts";

export { withSavedModels } from "./model/defaults.ts";

export {
  connectSettings,
  DEFAULT_APPEARANCE,
  setAppearance,
  setSessionDefault,
  settingsStore,
  useSessionDefault,
  useSettings,
} from "./store.ts";

export { SettingsPage } from "./ui/SettingsPage.tsx";
