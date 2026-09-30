/**
 * The app settings the renderer reads and changes: appearance, each Harness's
 * defaults for new sessions, and whether they start on a new Worktree. Main owns the file; a change is shown
 * at once here, then saved, and every window hears it back as an `AppEvent`.
 */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type {
  Appearance,
  AppearancePatch,
  PolarisApi,
  SessionDefault,
  SessionDefaults,
} from "../../../shared/api.ts";

export interface SettingsState {
  readonly appearance: Appearance;
  readonly sessionDefaults: SessionDefaults;
  /** New sessions start on a new Worktree; off means in the Workspace directory. */
  readonly newWorktree: boolean;
  /** Empty until main answers. */
  readonly version: string;
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "system",
  density: "calm",
  textSize: "default",
  diffPalette: "default",
  motion: "system",
  codeFont: "sf-mono",
  codeFontSize: 13,
};

export const settingsStore = createStore<SettingsState>(() => ({
  appearance: DEFAULT_APPEARANCE,
  sessionDefaults: {},
  newWorktree: false,
  version: "",
}));

let bridge: PolarisApi | null = null;

/** Loads the settings from main and keeps them current; call once per window. */
export const connectSettings = (api: PolarisApi) => {
  bridge = api;

  void api.request("settings.get", {}).then((result) => {
    if (!result.ok) return;
    const v = result.value;

    settingsStore.setState({
      appearance: {
        theme: v.theme,
        density: v.density,
        textSize: v.textSize,
        diffPalette: v.diffPalette,
        motion: v.motion,
        codeFont: v.codeFont,
        codeFontSize: v.codeFontSize,
      },
      sessionDefaults: v.sessionDefaults,
      newWorktree: v.newWorktree,
      version: v.version,
    });
  });

  return api.onAppEvent((event) => {
    if (event.kind === "appearance") settingsStore.setState({ appearance: event.appearance });

    if (event.kind === "session-defaults") {
      settingsStore.setState({ sessionDefaults: event.sessionDefaults });
    }

    if (event.kind === "new-worktree") settingsStore.setState({ newWorktree: event.on });
  });
};

export const setAppearance = (patch: AppearancePatch) => {
  settingsStore.setState((s) => ({ appearance: { ...s.appearance, ...patch } }));
  void bridge?.request("settings.setAppearance", { patch });
};

export const setSessionDefault = (harness: string, value: SessionDefault | null) => {
  settingsStore.setState((s) => {
    const others = Object.entries(s.sessionDefaults).filter(([kind]) => kind !== harness);

    return {
      sessionDefaults: Object.fromEntries(value === null ? others : [...others, [harness, value]]),
    };
  });
  void bridge?.request("settings.setSessionDefault", { harness, value });
};

export const setNewWorktree = (on: boolean) => {
  settingsStore.setState({ newWorktree: on });
  void bridge?.request("settings.setNewWorktree", { on });
};

export const useSettings = <A>(select: (state: SettingsState) => A): A =>
  useStore(settingsStore, select);

/**
 * What a new Agent Session of `harness` starts with, as set in Settings → Harnesses;
 * null when the user hasn't chosen (the Harness's own defaults apply).
 */
export const useSessionDefault = (harness: string): SessionDefault | null =>
  useSettings((s) => s.sessionDefaults[harness] ?? null);
