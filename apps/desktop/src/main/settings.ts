/**
 * App settings in `<userData>/settings.json`: appearance, each Harness's
 * defaults for new sessions, and the remote Hosts (by `~/.ssh/config` alias). A missing or unreadable file means
 * the defaults; the file is rewritten whole on every change.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Option, Schema } from "effect";
import {
  CodeFont,
  CodeFontSize,
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

export const RemoteHostSetting = Schema.Struct({
  keepDaemonUpToDate: Schema.optionalKey(Schema.Boolean),
  alias: Schema.String.check(Schema.isMinLength(1)),
  label: Schema.optionalKey(Schema.String),
  colour: Schema.optionalKey(Schema.NullOr(Schema.String)),
  forwardAgent: Schema.optionalKey(Schema.Boolean),
  /** The remote command as one shell line; absent for `~/.polaris/bin/current/polaris bridge`. */
  remoteCommand: Schema.optionalKey(Schema.String),
});

export type RemoteHostSetting = typeof RemoteHostSetting.Type;

export const Settings = Schema.Struct({
  keepDaemonsUpToDate: Schema.optionalKey(Schema.Boolean),
  theme: Schema.optionalKey(ThemeSource),
  density: Schema.optionalKey(Density),
  textSize: Schema.optionalKey(TextSize),
  diffPalette: Schema.optionalKey(DiffPalette),
  motion: Schema.optionalKey(MotionSource),
  codeFont: Schema.optionalKey(CodeFont),
  codeFontSize: Schema.optionalKey(CodeFontSize),
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
  mkdirSync(dirname(path), { recursive: true });
  const partial = `${path}.part`;

  writeFileSync(partial, `${JSON.stringify(settings, null, 2)}\n`);
  renameSync(partial, path);
};

/** The appearance a settings file asks for, with the defaults filled in. */
export const appearanceOf = (settings: Settings) => ({
  theme: settings.theme ?? "system",
  density: settings.density ?? "calm",
  textSize: settings.textSize ?? "default",
  diffPalette: settings.diffPalette ?? "default",
  motion: settings.motion ?? "system",
  codeFont: settings.codeFont ?? "sf-mono",
  codeFontSize: settings.codeFontSize ?? 13,
});

/** Settings → Sessions as a settings file asks for it, with the defaults filled in. */
export const sessionPrefsOf = (settings: Settings): SessionPrefs => ({
  ...DEFAULT_SESSION_PREFS,
  newWorktree: settings.newWorktree ?? DEFAULT_SESSION_PREFS.newWorktree,
  ...settings.sessions,
});
