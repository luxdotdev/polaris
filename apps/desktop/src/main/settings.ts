/**
 * App settings in `<userData>/settings.json`: the theme override and the
 * remote Hosts (by `~/.ssh/config` alias). A missing or unreadable file means
 * the defaults; the file is rewritten whole on every change.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Option, Schema } from "effect";
import { ThemeSource } from "../shared/contract.ts";

export const RemoteHostSetting = Schema.Struct({
  alias: Schema.String.check(Schema.isMinLength(1)),
  label: Schema.optionalKey(Schema.String),
  colour: Schema.optionalKey(Schema.NullOr(Schema.String)),
  forwardAgent: Schema.optionalKey(Schema.Boolean),
});

export type RemoteHostSetting = typeof RemoteHostSetting.Type;

export const Settings = Schema.Struct({
  theme: Schema.optionalKey(ThemeSource),
  hosts: Schema.optionalKey(Schema.Array(RemoteHostSetting)),
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
