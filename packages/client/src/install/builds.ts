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
  /** Uploaded with mode 755 (the binary always is; Betterleaks beside it too). */
  readonly executable: boolean;
}

export interface DaemonBuild {
  readonly platform: Platform;
  readonly version: string;
  /** SHA-256 of the `polaris` binary: what the user approves before a first install. */
  readonly sha256: string;
  /** The binary first, then the files that travel with it. */
  readonly files: ReadonlyArray<BuildFile>;
}

const FileEntry = Schema.Struct({
  sha256: Schema.String,
  size: Schema.Number,
  /** Absent in manifests from before executables travelled beside the binary. */
  executable: Schema.optional(Schema.Boolean),
});

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
          executable: name === build.binary || build.files[name]!.executable === true,
        })),
      },
    ];
  });
};

const isNumeric = (identifier: string): boolean => /^\d+$/.test(identifier);

/** Semver precedence of one prerelease identifier: numbers sort numerically and before words. */
const compareIdentifiers = (a: string, b: string): number => {
  if (a === b) return 0;

  if (isNumeric(a) && isNumeric(b)) return BigInt(a) < BigInt(b) ? -1 : 1;

  if (isNumeric(a) !== isNumeric(b)) return isNumeric(a) ? -1 : 1;

  return a < b ? -1 : 1;
};

const comparePrereleases = (a: string | undefined, b: string | undefined): number => {
  if (a === b) return 0;

  if (a === undefined) return 1;

  if (b === undefined) return -1;
  const partsA = a.split(".");
  const partsB = b.split(".");

  for (let i = 0; i < Math.min(partsA.length, partsB.length); i++) {
    const diff = compareIdentifiers(partsA[i]!, partsB[i]!);

    if (diff !== 0) return diff;
  }

  return partsA.length - partsB.length;
};

interface ParsedVersion {
  readonly core: number[];
  readonly prerelease: string | undefined;
  /** What follows `-dev.` in a dev build (`scripts/buildVersion.ts`). */
  readonly dev: string | undefined;
}

const parseVersion = (version: string): ParsedVersion => {
  const [withoutBuild = ""] = version.split("+", 1);
  const devMatch = /^(.*?)-dev\.(\d+\..*)$/.exec(withoutBuild);
  const base = devMatch ? devMatch[1]! : withoutBuild;
  const dash = base.indexOf("-");

  return {
    core: (dash === -1 ? base : base.slice(0, dash)).split(".").map(Number),
    prerelease: dash === -1 ? undefined : base.slice(dash + 1),
    dev: devMatch?.[2],
  };
};

/**
 * Compare versions by semver precedence: dotted numbers, then an optional
 * `-prerelease` that sorts before its release (`1.0.0-alpha.1` < `1.0.0-alpha.2`
 * < `1.0.0-beta.1` < `1.0.0-rc.1` < `1.0.0`); `+build` is ignored. A dev build of
 * a version sorts just before it, and dev builds of one version by commit count.
 * Returns <0, 0 or >0.
 */
export const compareVersions = (a: string, b: string): number => {
  const left = parseVersion(a);
  const right = parseVersion(b);

  for (let i = 0; i < Math.max(left.core.length, right.core.length); i++) {
    const diff = (left.core[i] ?? 0) - (right.core[i] ?? 0);

    if (diff !== 0) return diff;
  }

  return (
    comparePrereleases(left.prerelease, right.prerelease) || comparePrereleases(left.dev, right.dev)
  );
};

/** A dev build's version (`scripts/buildVersion.ts`): `<version>-dev.<commit count>.<sha>…`. */
export const isDevVersion = (version: string): boolean => /-dev\.\d+\.[0-9a-f]+/.test(version);

/**
 * Whether a Host running `installed` should get the `bundled` build. A release
 * replaces only an older version. A dev build replaces any other version, newer
 * or older: a dev Client installs exactly the build it carries.
 */
export const upgradeDue = (installed: string, bundled: string): boolean => {
  if (installed === bundled) return false;

  return isDevVersion(bundled) || compareVersions(installed, bundled) < 0;
};

/**
 * `upgradeDue` for a check no one asked for (a reconnect): it never moves a Host
 * to an older dev build. A stale dev Client would otherwise downgrade a newer
 * Daemon whose event log the older build cannot read; only the user's request does that.
 */
export const backgroundUpgradeDue = (installed: string, bundled: string): boolean =>
  upgradeDue(installed, bundled) &&
  !(isDevVersion(installed) && isDevVersion(bundled) && compareVersions(installed, bundled) > 0);
