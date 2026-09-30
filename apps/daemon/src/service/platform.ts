/**
 * Identity of this Daemon build: its version and the platform it was built
 * for. `polaris version` prints `polaris <version> <platform>`, which the
 * Client and `polaris upgrade` parse with `parseVersionLine`.
 *
 * On Linux the platform names the C library too: `linux-x64` and
 * `linux-arm64` are glibc builds, `linux-x64-musl` and `linux-arm64-musl`
 * musl builds (Alpine). A binary only runs on its own libc, so the running
 * process's libc is the build's.
 */
import { readdirSync } from "node:fs";
import pkg from "../../package.json" with { type: "json" };

/** The platforms the Daemon ships for (ENG-181). */
export const PLATFORMS = [
  "darwin-arm64",
  "linux-x64",
  "linux-arm64",
  "linux-x64-musl",
  "linux-arm64-musl",
] as const;

export type Platform = (typeof PLATFORMS)[number];

/** The `bun build --compile --target` for each platform. */
export const BUN_TARGETS: Record<Platform, string> = {
  "darwin-arm64": "bun-darwin-arm64",
  "linux-x64": "bun-linux-x64",
  "linux-arm64": "bun-linux-arm64",
  "linux-x64-musl": "bun-linux-x64-musl",
  "linux-arm64-musl": "bun-linux-arm64-musl",
};

/**
 * This build's version: the one `scripts/build-daemon.ts` compiled in (it replaces
 * `process.env.POLARIS_BUILD_VERSION` with a constant), else the package's, from source.
 */
export const VERSION: string = process.env.POLARIS_BUILD_VERSION ?? pkg.version;

export const isPlatform = (value: string): value is Platform =>
  PLATFORMS.some((platform) => platform === value);

let musl: boolean | undefined;

/** Whether this process runs on musl libc (its loader is `/lib/ld-musl-<arch>.so.1`). */
export const isMusl = (): boolean => {
  if (musl !== undefined) return musl;
  musl = false;

  if (process.platform === "linux") {
    try {
      musl = readdirSync("/lib").some((f) => f.startsWith("ld-musl-"));
    } catch {}
  }

  return musl;
};

/** `<os>-<arch>`, plus `-musl` on a musl Linux. */
export const runtimePlatform = (): string =>
  `${process.platform}-${process.arch}${isMusl() ? "-musl" : ""}`;

/** This process's platform, or null when the Daemon does not ship for it. */
export const currentPlatform = (): Platform | null => {
  const id = runtimePlatform();

  return isPlatform(id) ? id : null;
};

export const versionLine = (): string => `polaris ${VERSION} ${runtimePlatform()}`;

export interface VersionInfo {
  readonly version: string;
  readonly platform: string;
}

/** Parses the output of `polaris version`; null if it is not one. */
export const parseVersionLine = (output: string): VersionInfo | null => {
  const match = /^polaris (\S+) (\S+)\s*$/m.exec(output.trim());

  return match ? { version: match[1]!, platform: match[2]! } : null;
};

/**
 * Whether this process is a `bun build --compile` binary (its entry module
 * lives in Bun's embedded filesystem) rather than `bun src/main.ts`.
 */
export const isCompiled = (): boolean =>
  Bun.main.startsWith("/$bunfs/") || Bun.main.includes("~BUN");
