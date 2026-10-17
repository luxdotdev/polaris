/**
 * What this Host is (os, arch, C library), decided from injected facts so the
 * rule is testable anywhere. `index.ts` feeds it the real process and filesystem.
 */

/** `none` off Linux; `unknown` is a Linux with neither loader found. */
export type Libc = "none" | "glibc" | "musl" | "unknown";

export interface PlatformFacts {
  readonly os: string;
  readonly arch: string;
  readonly libc: Libc;
}

export interface PlatformProbe {
  readonly os: string;
  readonly arch: string;
  /** The build-time `process.env.POLARIS_LIBC` define: "gnu" or "musl" in compiled Linux builds. */
  readonly compiledLibc: string | undefined;
  readonly exists: (path: string) => boolean;
}

/** glibc's dynamic loaders, as the Client's probe lists them (`GLIBC_LOADERS`, ADR 0043). */
export const GLIBC_LOADERS = {
  x64: ["/lib64/ld-linux-x86-64.so.2", "/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2"],
  arm64: ["/lib/ld-linux-aarch64.so.1", "/lib/aarch64-linux-gnu/ld-linux-aarch64.so.1"],
} as const;

const glibcLoaders = (arch: string): ReadonlyArray<string> => {
  if (arch === "x64") return GLIBC_LOADERS.x64;

  return arch === "arm64" ? GLIBC_LOADERS.arm64 : [];
};

/** musl's loader, which is also its libc. */
export const muslLoader = (arch: string): string =>
  `/lib/ld-musl-${arch === "x64" ? "x86_64" : "aarch64"}.so.1`;

/**
 * A compiled build's libc is the one it was built for. From source, glibc wins:
 * a Host with a glibc loader is glibc even with musl's installed beside it.
 */
export const detectPlatform = ({
  os,
  arch,
  compiledLibc,
  exists,
}: PlatformProbe): PlatformFacts => {
  if (os !== "linux") return { os, arch, libc: "none" };

  if (compiledLibc === "gnu") return { os, arch, libc: "glibc" };

  if (compiledLibc === "musl") return { os, arch, libc: "musl" };

  if (glibcLoaders(arch).some((path) => exists(path))) return { os, arch, libc: "glibc" };

  return { os, arch, libc: exists(muslLoader(arch)) ? "musl" : "unknown" };
};

/** The os part of a build id: Node's `win32` ships as `windows`. */
export const buildOsOf = (os: string): string => (os === "win32" ? "windows" : os);

/** The build id `polaris version` prints and `upgrade` checks: `<os>-<arch>`, `-musl` on musl. */
export const runtimePlatformOf = (facts: PlatformFacts): string =>
  `${buildOsOf(facts.os)}-${facts.arch}${facts.libc === "musl" ? "-musl" : ""}`;

/** The library `bun:ffi` binds libc calls from: libSystem, musl's loader, or glibc's `libc.so.6`. */
export const libcPathOf = (facts: PlatformFacts): string => {
  if (facts.os === "darwin") return "/usr/lib/libSystem.B.dylib";

  return facts.libc === "musl" ? muslLoader(facts.arch) : "libc.so.6";
};

/**
 * Whether `path` is inside a compiled binary's embedded filesystem: `/$bunfs/…` on
 * macOS and Linux, `B:\~BUN\…` on Windows (`/B:/%7EBUN/…` as a URL pathname).
 */
export const isEmbeddedPath = (path: string): boolean =>
  path.startsWith("/$bunfs/") || /^\/?[A-Za-z]:[\\/](~|%7E)BUN[\\/]/i.test(path);
