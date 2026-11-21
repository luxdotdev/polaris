/** Client Settings published by the Desktop App; schemas own discovery and validation. */
import { describeSetting, setting, type SettingValue } from "@polaris/protocol";
import { Schema } from "effect";
import {
  CodeFont,
  CodeFontSize,
  DarkTheme,
  Density,
  DiffPalette,
  MotionSource,
  TextSize,
  ThemeSource,
  SessionPrefs,
} from "./contract.ts";
import { DEFAULT_SESSION_PREFS } from "./sessionPrefs.ts";
import {
  DEFAULT_PREDICTION_PREFERENCES,
  PredictionPreferences,
  PredictionClientEndpoints,
} from "./predictionPlacement.ts";

export const ClientSettingFields = {
  predictionEnabled: setting(Schema.Boolean, {
    description: "Enable tab completion in the Editor.",
    default: false,
  }),
  automaticAppUpdates: setting(Schema.Boolean, {
    description: "Download Desktop App updates automatically.",
    default: true,
  }),
  appUpdateChannel: setting(Schema.Literals(["stable", "nightly"]), {
    description: "Desktop App update Channel: stable releases or nightly builds.",
    default: "stable",
  }),
  prediction: setting(PredictionPreferences, {
    description:
      "Tab completion preferences for this Host: placement, model, display, aggressiveness and languages.",
    default: DEFAULT_PREDICTION_PREFERENCES,
  }),
  predictionClientEndpoints: setting(PredictionClientEndpoints, {
    description: "Model server endpoints running on this Client for tab completion.",
    default: [],
  }),
  theme: setting(ThemeSource, {
    description: "Appearance: follow the system theme, or always use dark or light.",
    default: "system",
  }),
  darkTheme: setting(DarkTheme, {
    description: "Dark appearance: Moonlit or Midnight.",
    default: "moonlit",
  }),
  density: setting(Density, {
    description: "Spacing and row heights: Calm, Balanced or Compact.",
    default: "calm",
  }),
  textSize: setting(TextSize, {
    description: "Text size throughout the Desktop App.",
    default: "default",
  }),
  diffPalette: setting(DiffPalette, {
    description: "Diff colours: default or colourblind-safe blue and orange.",
    default: "default",
  }),
  motion: setting(MotionSource, {
    description:
      "Follow the system's Reduce Motion preference, reduce motion, or allow full motion.",
    default: "system",
  }),
  codeFont: setting(CodeFont, {
    description: "Monospaced font for code: SF Mono or Menlo.",
    default: "sf-mono",
  }),
  codeFontSize: setting(CodeFontSize, {
    description: "Code font size in pixels at the default text size.",
    default: 13,
  }),
  wordWrap: setting(Schema.Boolean, {
    description: "Wrap long lines in the Editor, Review and Changes.",
    default: false,
  }),
};

export const ClientSessionFields = {
  openOutputOnEdit: setting(SessionPrefs.fields.openOutputOnEdit, {
    description: "Open Output on a Turn's first edit.",
    default: DEFAULT_SESSION_PREFS.openOutputOnEdit,
  }),
  notifyNeedsYou: setting(SessionPrefs.fields.notifyNeedsYou, {
    description: "Send a native notification when an agent session needs you.",
    default: DEFAULT_SESSION_PREFS.notifyNeedsYou,
  }),
  notifyTurnEnded: setting(SessionPrefs.fields.notifyTurnEnded, {
    description: "Send a native notification when a Turn ends.",
    default: DEFAULT_SESSION_PREFS.notifyTurnEnded,
  }),
  notifyLongTurnsOnly: setting(SessionPrefs.fields.notifyLongTurnsOnly, {
    description: "Only notify about completed Turns longer than longTurnMinutes.",
    default: DEFAULT_SESSION_PREFS.notifyLongTurnsOnly,
  }),
  longTurnMinutes: setting(SessionPrefs.fields.longTurnMinutes, {
    description: "Minimum Turn duration in minutes for long-Turn notifications.",
    default: DEFAULT_SESSION_PREFS.longTurnMinutes,
  }),
  notifyReviewRequests: setting(SessionPrefs.fields.notifyReviewRequests, {
    description: "Send native notifications for GitHub review requests.",
    default: DEFAULT_SESSION_PREFS.notifyReviewRequests,
  }),
  notifyConstellations: setting(SessionPrefs.fields.notifyConstellations, {
    description: "Send native notifications when a Constellation needs you.",
    default: DEFAULT_SESSION_PREFS.notifyConstellations,
  }),
  quietPhoneWhilePresent: setting(SessionPrefs.fields.quietPhoneWhilePresent, {
    description: "Hold pushes to linked phones while you are at this computer.",
    default: DEFAULT_SESSION_PREFS.quietPhoneWhilePresent,
  }),
  spinnerVerbs: setting(SessionPrefs.fields.spinnerVerbs, {
    description: "Working strip verbs; null uses the built-in verbs.",
    default: DEFAULT_SESSION_PREFS.spinnerVerbs,
  }),
  editorVim: setting(SessionPrefs.fields.editorVim, {
    description: "Use Vim keys in the Editor.",
    default: DEFAULT_SESSION_PREFS.editorVim,
  }),
  editorAutosave: setting(SessionPrefs.fields.editorAutosave, {
    description: "Save Editor files after a short pause in typing.",
    default: DEFAULT_SESSION_PREFS.editorAutosave,
  }),
  editorInlineDiagnostics: setting(SessionPrefs.fields.editorInlineDiagnostics, {
    description: "Show each line's most severe diagnostic at its end.",
    default: DEFAULT_SESSION_PREFS.editorInlineDiagnostics,
  }),
  editorInlineBlame: setting(SessionPrefs.fields.editorInlineBlame, {
    description: "Show the cursor line's author, time and Origins at its end.",
    default: DEFAULT_SESSION_PREFS.editorInlineBlame,
  }),
  advancedView: setting(SessionPrefs.fields.advancedView, {
    description: "Show reply latency, tokens and tokens per second.",
    default: DEFAULT_SESSION_PREFS.advancedView,
  }),
};

const keysOf = <T extends object>(value: T) => {
  // SAFETY: these closed, locally declared schema registries have only their declared string keys.
  return Object.keys(value) as Array<Extract<keyof T, string>>;
};

export const ClientSessionKey = Schema.Literals(keysOf(ClientSessionFields));

const sessionEntries = Object.entries(ClientSessionFields).map(([key, schema]) => ({
  key: `sessions.${key}`,
  schema,
  description: describeSetting(`sessions.${key}`, schema),
}));

export const ClientSettingsSchema = Schema.Struct(ClientSettingFields);

export type ClientSettingsValues = typeof ClientSettingsSchema.Type;

export type ClientSettingsSource = Partial<ClientSettingsValues> & {
  sessions?: Partial<typeof SessionPrefs.Type>;
};

const rootKey = Schema.Literals(keysOf(ClientSettingFields));

const roots = Object.entries(ClientSettingFields).map(([key, schema]) => ({
  key,
  schema,
  description: describeSetting(key, schema),
}));

const entries = [...roots, ...sessionEntries];

export const readClientSetting = (settings: ClientSettingsSource, key: string) => {
  const raw = key.startsWith("sessions.")
    ? settings.sessions?.[Schema.decodeUnknownSync(ClientSessionKey)(key.slice(9))]
    : settings[Schema.decodeUnknownSync(rootKey)(key)];

  return raw === undefined ? undefined : Schema.decodeUnknownSync(Schema.Json)(raw);
};

export const clientSettingsSnapshot = (
  settings: ClientSettingsSource
): ReadonlyArray<SettingValue> =>
  entries.map(({ description }) => {
    const raw = readClientSetting(settings, description.key);

    return {
      ...description,
      value: raw === undefined ? description.default : raw,
      overridden: raw !== undefined,
    };
  });

export const decodeClientSetting = (key: string, value: SettingValue["value"]) => {
  const entry = entries.find((e) => e.description.key === key);

  if (entry === undefined) throw new Error(`Unknown Client Setting: ${key}`);

  return Schema.decodeUnknownSync(Schema.Json)(Schema.decodeUnknownSync(entry.schema)(value));
};
