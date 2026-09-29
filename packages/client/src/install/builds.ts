/**
 * The Daemon builds the Desktop App bundles: one per platform, as produced
 * by `scripts/build-daemon.ts` (`<dir>/manifest.json` plus
 * `<dir>/<platform>/polaris`, a single self-contained file today; any other
 * files the manifest lists travel with it). Nothing is ever downloaded on
 * the Host.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";

export const PLATFORMS = [
  "darwin-arm64",
  "linux-x64",
  "linux-arm64",
  "linux-x64-musl",
  "linux-arm64-musl",
] as const;

export type Platform = (typeof PLATFORMS)[number];

const isPlatform = Schema.is(Schema.Literals(PLATFORMS));

/** A Linux Host's C library: glibc builds don't run on musl (Alpine) and vice versa. */
export type Libc = "gnu" | "musl";

/**
 * Map `uname -s` / `uname -m` (and, on Linux, the C library) to a Daemon
 * platform; null if we do not ship one.
 */
export const platformFromUname = (
  os: string,
  arch: string,
  libc: Libc = "gnu"
): Platform | null => {
  const system = os.trim().toLowerCase();
  const machine = arch.trim().toLowerCase();
  const musl = libc === "musl";

  if (system === "darwin" && (machine === "arm64" || machine === "aarch64")) return "darwin-arm64";

  if (system === "linux" && (machine === "x86_64" || machine === "amd64"))
    return musl ? "linux-x64-musl" : "linux-x64";

  if (system === "linux" && (machine === "aarch64" || machine === "arm64"))
    return musl ? "linux-arm64-musl" : "linux-arm64";

  return null;
};

/**
 * Shared libraries Bun's musl runtime links dynamically. Alpine's minimal
 * images lack them; installing them needs root (`apk add libstdc++ libgcc`).
 */
export const MUSL_RUNTIME_LIBRARIES = ["libstdc++.so.6", "libgcc_s.so.1"] as const;

export const MUSL_RUNTIME_PACKAGES = ["libstdc++", "libgcc"] as const;

export interface BuildFile {
  readonly name: string;
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

export interface DaemonBuild {
  readonly platform: Platform;
  readonly version: string;
  /** SHA-256 of the `polaris` binary: what the user approves before a first install. */
  readonly sha256: string;
  /** The binary first, then the files that travel with it. */
  readonly files: ReadonlyArray<BuildFile>;
}

const FileEntry = Schema.Struct({ sha256: Schema.String, size: Schema.Number });

const Manifest = Schema.Struct({
  version: Schema.String,
  platforms: Schema.Record(
    Schema.String,
    Schema.Struct({
      binary: Schema.String,
      sha256: Schema.String,
      files: Schema.Record(Schema.String, FileEntry),
    })
  ),
});

/** Read the bundled builds from a `dist` directory holding `manifest.json`. */
export const loadBuilds = (distDir: string): ReadonlyArray<DaemonBuild> => {
  const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(Manifest))(
    readFileSync(join(distDir, "manifest.json"), "utf8")
  );

  return Object.entries(manifest.platforms).flatMap(([platform, build]) => {
    if (!isPlatform(platform)) return [];

    const names = [
      build.binary,
      ...Object.keys(build.files).filter((name) => name !== build.binary),
    ];

    return [
      {
        platform,
        version: manifest.version,
        sha256: build.sha256,
        files: names.map((name) => ({
          name,
          path: join(distDir, platform, name),
          sha256: build.files[name]!.sha256,
          size: build.files[name]!.size,
        })),
      },
    ];
  });
};

/**
 * Compare dotted versions with an optional `-prerelease` (a prerelease sorts
 * before its release). Returns <0, 0 or >0.
 */
export const compareVersions = (a: string, b: string): number => {
  const [coreA = "", preA] = a.split("-", 2);
  const [coreB = "", preB] = b.split("-", 2);
  const partsA = coreA.split(".").map(Number);
  const partsB = coreB.split(".").map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);

    if (diff !== 0) return diff;
  }

  if (preA === preB) return 0;

  if (preA === undefined) return 1;

  if (preB === undefined) return -1;

  return preA.localeCompare(preB, undefined, { numeric: true });
};
