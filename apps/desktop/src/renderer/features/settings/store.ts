import { useEffect } from "react";
/**
 * The app settings the renderer reads and changes: appearance, each Harness's
 * defaults for new sessions, and Settings → Sessions. Main owns the file; a change is shown
 * at once here, then saved, and every window hears it back as an `AppEvent`.
 */
import type { KeybindingOverridesValue } from "../../../shared/keybindingResolution.ts";
import { setKeybindingOverrides } from "../../../shared/keybindingResolution.ts";
import { Option, Schema } from "effect";
import { KeybindingOverrides } from "../../../shared/keybindingOverrides.ts";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type {
  Appearance,
  AppearancePatch,
  PolarisApi,
  SessionDefault,
  SessionDefaults,
  SessionPrefs,
  SessionPrefsPatch,
} from "../../../shared/api.ts";
import { DEFAULT_SESSION_PREFS } from "../../../shared/sessionPrefs.ts";

export interface SettingsState {
  readonly keybindings: KeybindingOverridesValue;
  readonly appearance: Appearance;
  readonly sessionDefaults: Readonly<Record<string, SessionDefaults>>;
  readonly sessions: SessionPrefs;
  /** Empty until main answers. */
  readonly version: string;
  /** Polaris Dev: Developer Mode comes from its leases and the switch is locked on. */
  readonly developmentBuild: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "system",
  darkTheme: "moonlit",
  density: "calm",
  textSize: "default",
  diffPalette: "default",
  motion: "system",
  codeFont: "sf-mono",
  codeFontSize: 13,
  wordWrap: false,
};

export const settingsStore = createStore<SettingsState>(() => ({
  keybindings: {},
  appearance: DEFAULT_APPEARANCE,
  sessionDefaults: {},
  sessions: DEFAULT_SESSION_PREFS,
  version: "",
  developmentBuild: false,
}));

let bridge: PolarisApi | null = null;

let keybindingsRevision = 0;

/** Loads the settings from main and keeps them current; call once per window. */
export const connectSettings = (api: PolarisApi) => {
  bridge = api;

  const initialKeybindingsRevision = keybindingsRevision;

  void api.request("settings.get", {}).then((result) => {
    if (!result.ok) return;
    const v = result.value;

    const keybindings =
      initialKeybindingsRevision === keybindingsRevision
        ? (v.keybindings ?? {})
        : settingsStore.getState().keybindings;

    setKeybindingOverrides(keybindings);
    settingsStore.setState({
      keybindings,
      appearance: {
        theme: v.theme,
        darkTheme: v.darkTheme,
        density: v.density,
        textSize: v.textSize,
        diffPalette: v.diffPalette,
        motion: v.motion,
        codeFont: v.codeFont,
        codeFontSize: v.codeFontSize,
        wordWrap: v.wordWrap,
      },
      sessions: v.sessions,
      version: v.version,
      developmentBuild: v.developmentBuild,
    });
  });

  return api.onAppEvent((event) => {
    if (event.kind === "keybindings") {
      keybindingsRevision++;
      setKeybindingOverrides(event.keybindings);
      settingsStore.setState({ keybindings: event.keybindings });
    }

    if (event.kind === "appearance") settingsStore.setState({ appearance: event.appearance });

    if (event.kind === "session-defaults") {
      settingsStore.setState((state) => ({
        sessionDefaults: { ...state.sessionDefaults, [event.hostKey]: event.sessionDefaults },
      }));
    }

    if (event.kind === "sessions") settingsStore.setState({ sessions: event.sessions });
  });
};

export const setKeybindings = async (value: KeybindingOverridesValue): Promise<string | null> => {
  const parsed = Schema.decodeUnknownOption(KeybindingOverrides)(value);

  if (Option.isNone(parsed)) return "Invalid keybindings.";

  if (bridge === null) return "Settings are not connected.";

  try {
    const revision = keybindingsRevision;
    const result = await bridge.request("clientSettings.set", { key: "keybindings", value });

    if (!result.ok) return result.error.message;

    if (revision === keybindingsRevision) {
      setKeybindingOverrides(value);
      settingsStore.setState({ keybindings: value });
    }

    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Couldn’t save shortcuts.";
  }
};

export const setAppearance = (patch: AppearancePatch) => {
  settingsStore.setState((s) => ({ appearance: { ...s.appearance, ...patch } }));
  void bridge?.request("settings.setAppearance", { patch });
};

export const setSessionDefault = (
  hostKey: string,
  harness: string,
  value: SessionDefault | null
) => {
  settingsStore.setState((s) => {
    const others = Object.entries(s.sessionDefaults[hostKey] ?? {}).filter(
      ([kind]) => kind !== harness
    );

    return {
      sessionDefaults: {
        ...s.sessionDefaults,
        [hostKey]: Object.fromEntries(value === null ? others : [...others, [harness, value]]),
      },
    };
  });
  void bridge?.request("settings.setSessionDefault", { hostKey, harness, value });
};

const EMPTY_DEFAULTS: SessionDefaults = {};

export const useHostSessionDefaults = (hostKey: string | null): SessionDefaults => {
  useEffect(() => {
    if (hostKey === null) return;

    void bridge?.request("settings.getSessionDefaults", { hostKey }).then((result) => {
      if (result.ok)
        settingsStore.setState((s) => ({
          sessionDefaults: { ...s.sessionDefaults, [hostKey]: result.value },
        }));
    });
  }, [hostKey]);

  return useSettings((s) =>
    hostKey === null ? EMPTY_DEFAULTS : (s.sessionDefaults[hostKey] ?? EMPTY_DEFAULTS)
  );
};

export const setSessionPrefs = (patch: SessionPrefsPatch) => {
  settingsStore.setState((s) => ({ sessions: { ...s.sessions, ...patch } }));
  void bridge?.request("settings.setSessions", { patch });
};

export const useSettings = <A>(select: (state: SettingsState) => A): A =>
  useStore(settingsStore, select);

/**
 * What a new Agent Session of `harness` starts with, as set in Settings → Harnesses;
 * null when the user hasn't chosen (the Harness's own defaults apply).
 */
export const useSessionDefault = (harness: string, hostKey: string | null): SessionDefault | null =>
  useHostSessionDefaults(hostKey)[harness] ?? null;
