/**
 * App settings in `<userData>/settings.json`: appearance, each Harness's
 * defaults for new sessions, and the remote Hosts (by `~/.ssh/config` alias). A missing or unreadable file means
 * the defaults; the file is rewritten whole on every change.
 */
import { PredictionClientEndpoints, PredictionPreferences } from "../shared/predictionPlacement.ts";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { LanguageSettingsRecord, LanguagePreviewPolicy } from "@polaris/protocol";
import { Option, Schema } from "effect";
import {
  CodeFont,
  CodeFontSize,
  DarkTheme,
  Density,
  DiffPalette,
  MotionSource,
  SessionDefault,
  type SessionPrefs,
  SessionPrefsPatch,
  TextSize,
  ThemeSource,
} from "../shared/contract.ts";
import { DEFAULT_SESSION_PREFS } from "../shared/sessionPrefs.ts";
import { DaemonUpdateResultSchema } from "../shared/daemonUpdates.ts";

export const RemoteHostSetting = Schema.Struct({
  keepDaemonUpToDate: Schema.optionalKey(Schema.Boolean),
  /** How the Host is reached; absent means ssh. For "wsl" the alias is the distro name. */
  kind: Schema.optionalKey(Schema.Literals(["ssh", "wsl"])),
  alias: Schema.String.check(Schema.isMinLength(1)),
  label: Schema.optionalKey(Schema.String),
  colour: Schema.optionalKey(Schema.NullOr(Schema.String)),
  forwardAgent: Schema.optionalKey(Schema.Boolean),
  /** The remote command as one shell line; absent for `~/.polaris/bin/current/polaris bridge`. */
  remoteCommand: Schema.optionalKey(Schema.String),
  /** A Windows Host's DefaultShell, as its install probe found it; absent on POSIX Hosts. */
  windowsShell: Schema.optionalKey(Schema.Literals(["powershell", "cmd"])),
});

export type RemoteHostSetting = typeof RemoteHostSetting.Type;

export const Settings = Schema.Struct({
  predictionEnabled: Schema.optionalKey(Schema.Boolean),
  predictionConfigured: Schema.optionalKey(Schema.Boolean),
  predictionDiscoveryShown: Schema.optionalKey(Schema.Boolean),
  predictionClientEndpoints: Schema.optionalKey(PredictionClientEndpoints),
  prediction: Schema.optionalKey(Schema.Record(Schema.String, PredictionPreferences)),
  sshBinary: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))),
  automaticAppUpdates: Schema.optionalKey(Schema.Boolean),
  appUpdateLastCheckedAt: Schema.optionalKey(Schema.Number),
  languageSettings: Schema.optionalKey(
    Schema.Array(LanguageSettingsRecord).check(Schema.isMaxLength(4096))
  ),
  languagePreviewPolicies: Schema.optionalKey(
    Schema.Array(LanguagePreviewPolicy).check(Schema.isMaxLength(4096))
  ),
  keepDaemonsUpToDate: Schema.optionalKey(Schema.Boolean),
  daemonUpdates: Schema.optionalKey(Schema.Record(Schema.String, DaemonUpdateResultSchema)),
  theme: Schema.optionalKey(ThemeSource),
  darkTheme: Schema.optionalKey(DarkTheme),
  density: Schema.optionalKey(Density),
  textSize: Schema.optionalKey(TextSize),
  diffPalette: Schema.optionalKey(DiffPalette),
  motion: Schema.optionalKey(MotionSource),
  codeFont: Schema.optionalKey(CodeFont),
  codeFontSize: Schema.optionalKey(CodeFontSize),
  wordWrap: Schema.optionalKey(Schema.Boolean),
  /** By Harness kind. */
  sessionDefaults: Schema.optionalKey(Schema.Record(Schema.String, SessionDefault)),
  /** Settings → Sessions; each missing field takes its default. */
  sessions: Schema.optionalKey(SessionPrefsPatch),
  /** Before Settings → Sessions: read as `sessions.newWorktree`, never written. */
  newWorktree: Schema.optionalKey(Schema.Boolean),
  hosts: Schema.optionalKey(Schema.Array(RemoteHostSetting)),
  /** The local Host on this machine; on unless switched off. */
  local: Schema.optionalKey(
    Schema.Struct({
      enabled: Schema.Boolean,
      keepDaemonUpToDate: Schema.optionalKey(Schema.Boolean),
    })
  ),
  /** Set once "Get started" is pressed on the welcome (onboarding O1). */
  welcomeSeen: Schema.optionalKey(Schema.Boolean),
});

export type Settings = typeof Settings.Type;

const decodeSettings = Schema.decodeUnknownOption(Schema.fromJsonString(Settings));

export const settingsPath = (userData: string) => join(userData, "settings.json");

/** Reads the settings; the defaults (`{}`) if the file is missing or invalid. */
export const readSettings = (path: string): Settings => {
  if (!existsSync(path)) return {};

  return Option.getOrElse(decodeSettings(readFileSync(path, "utf8")), () => {
    console.warn(`polaris: ignoring invalid settings at ${path}`);

    return {};
  });
};

export interface SettingsWrite {
  readonly path: string;
  readonly settings: Settings;
}

/** Atomic: written to a sibling file, then renamed over the old one. */
export const writeSettings = ({ path, settings }: SettingsWrite) => {
  const validated = Schema.decodeUnknownSync(Settings)(settings);
  mkdirSync(dirname(path), { recursive: true });
  const partial = `${path}.${randomUUID()}.part`;

  try {
    writeFileSync(partial, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    renameSync(partial, path);
  } finally {
    rmSync(partial, { force: true });
  }
};

/** The appearance a settings file asks for, with the defaults filled in. */
export const appearanceOf = (settings: Settings) => ({
  theme: settings.theme ?? "system",
  darkTheme: settings.darkTheme ?? "moonlit",
  density: settings.density ?? "calm",
  textSize: settings.textSize ?? "default",
  diffPalette: settings.diffPalette ?? "default",
  motion: settings.motion ?? "system",
  codeFont: settings.codeFont ?? "sf-mono",
  codeFontSize: settings.codeFontSize ?? 13,
  wordWrap: settings.wordWrap ?? false,
});

/** Settings → Sessions as a settings file asks for it, with the defaults filled in. */
export const sessionPrefsOf = (settings: Settings): SessionPrefs => ({
  ...DEFAULT_SESSION_PREFS,
  newWorktree: settings.newWorktree ?? DEFAULT_SESSION_PREFS.newWorktree,
  ...settings.sessions,
});
