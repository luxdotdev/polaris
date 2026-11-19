/** The site's feed answers, parsed at the boundary (apps/site/app/api/update/README.md). */
import { Option, Schema } from "effect";
import { versionFromAsset } from "./version.ts";

/** An Update the feed offers: what to download and what the local feed repeats to Squirrel. */
export interface OfferedUpdate {
  readonly version: string;
  readonly url: string;
  /** The asset's own file name, which Squirrel reads the version from. */
  readonly file: string;
  readonly bytes: number | null;
  readonly sha1: string | null;
  readonly name: string;
  readonly notes: string;
  readonly pubDate: string;
}

const MacRelease = Schema.Struct({
  url: Schema.String,
  name: Schema.optional(Schema.String),
  notes: Schema.optional(Schema.String),
  pub_date: Schema.optional(Schema.String),
});

/** The asset, and every address a redirect sends its download on to, is https. */
export const isHttps = (url: string) => URL.parse(url)?.protocol === "https:";

/** Only an https asset whose name carries a version is ever downloaded. */
const asset = (url: string) => {
  if (!URL.canParse(url)) return null;
  const parsed = new URL(url);
  const version = versionFromAsset(parsed.pathname);
  const file = parsed.pathname.split("/").at(-1) ?? "";

  return parsed.protocol === "https:" && version !== null && file !== ""
    ? { version, file, url: parsed.href }
    : null;
};

/** Squirrel.Mac JSON: `{ url, name, notes, pub_date }`. */
export const macRelease = (body: string): OfferedUpdate | null => {
  const release = Schema.decodeUnknownOption(Schema.fromJsonString(MacRelease))(body);

  if (Option.isNone(release)) return null;
  const found = asset(release.value.url);

  return found === null
    ? null
    : {
        ...found,
        bytes: null,
        sha1: null,
        name: release.value.name ?? `Polaris ${found.version}`,
        notes: release.value.notes ?? "",
        pubDate: release.value.pub_date ?? "",
      };
};

/** Squirrel.Windows RELEASES: `<sha1> <absolute nupkg url> <bytes>`, exactly one full package. */
export const windowsRelease = (body: string): OfferedUpdate | null => {
  const lines = body
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");

  const entry = lines.length === 1 ? /^([0-9a-f]{40}) (\S+) (\d+)$/i.exec(lines[0] ?? "") : null;

  if (entry === null) return null;
  const found = asset(entry[2] ?? "");
  const bytes = Number(entry[3]);

  return found === null || !Number.isSafeInteger(bytes) || bytes <= 0
    ? null
    : {
        ...found,
        bytes,
        sha1: (entry[1] ?? "").toLowerCase(),
        name: `Polaris ${found.version}`,
        notes: "",
        pubDate: "",
      };
};
