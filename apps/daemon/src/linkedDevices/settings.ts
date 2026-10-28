/**
 * The Relay route's setting for this Host: `root/relay-route.json` (0600), on or off
 * and the relay's URL. No file means off (CONTEXT.md: Remote Access).
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { secureRelayUrl } from "@polaris/protocol/relay";
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

/**
 * The stored setting; off when the file is missing or unreadable, or when its URL has
 * no TLS (saved before RX1-10): the user turns it on again with a wss:// URL.
 */
export const readSetting = (root: string): RelayRouteSetting => {
  const path = settingPath(root);

  if (!existsSync(path)) return OFF;
  const setting = Option.getOrElse(decode(readFileSync(path, "utf8")), () => OFF);

  return setting.url !== null && !isRelayUrl(setting.url)
    ? { ...setting, enabled: false }
    : setting;
};

export const writeSetting = (root: string, setting: RelayRouteSetting): void => {
  const path = settingPath(root);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${encode(setting)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
};

/** A relay URL the Daemon dials: wss://, or ws:// to a relay on this machine (RX1-10). */
export const isRelayUrl = secureRelayUrl;
