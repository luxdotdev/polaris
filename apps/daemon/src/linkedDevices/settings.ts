/**
 * The Relay route's setting for this Host: `root/relay-route.json` (0600), on or off
 * and the relay's URL. No file means off (CONTEXT.md: Remote Access).
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Option, Schema } from "effect";

export const RelayRouteSetting = Schema.Struct({
  enabled: Schema.Boolean,
  url: Schema.NullOr(Schema.String),
});

export type RelayRouteSetting = typeof RelayRouteSetting.Type;

const OFF: RelayRouteSetting = { enabled: false, url: null };

const codec = Schema.fromJsonString(RelayRouteSetting);

const decode = Schema.decodeUnknownOption(codec);

const encode = Schema.encodeSync(codec);

export const settingPath = (root: string) => join(root, "relay-route.json");

/** The stored setting; off when the file is missing or unreadable. */
export const readSetting = (root: string): RelayRouteSetting => {
  const path = settingPath(root);

  if (!existsSync(path)) return OFF;

  return Option.getOrElse(decode(readFileSync(path, "utf8")), () => OFF);
};

export const writeSetting = (root: string, setting: RelayRouteSetting): void => {
  const path = settingPath(root);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${encode(setting)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
};

/** A relay URL the Daemon dials: ws:// or wss:// with a host. */
export const isRelayUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);

    return (parsed.protocol === "wss:" || parsed.protocol === "ws:") && parsed.hostname !== "";
  } catch {
    return false;
  }
};
