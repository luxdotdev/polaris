/** Recent folders per Host, in this window's `localStorage`: a convenience, never the truth. */
import { Option, Schema } from "effect";
import { type RecentFolders, withRecentFolder } from "./model.ts";

const KEY = "polaris.openFolder.recent.v1";

const decode = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Array(Schema.String)))
);

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const readRecent = (): RecentFolders => {
  try {
    const raw = storage()?.getItem(KEY) ?? null;

    return raw === null ? {} : Option.getOrElse(decode(raw), () => ({}));
  } catch {
    return {};
  }
};

export const rememberFolder = (hostKey: string, path: string) => {
  try {
    storage()?.setItem(KEY, JSON.stringify(withRecentFolder(readRecent(), hostKey, path)));
  } catch {
    // Storage can be unavailable; recent folders then last for this session only.
  }
};
