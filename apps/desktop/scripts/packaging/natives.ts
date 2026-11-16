/**
 * Native modules in the main bundle (ENG-943): Bun emits every sodium-native prebuild the relay
 * client can load next to `out/main/index.js`. A package keeps only its own platform's, unpacked
 * from the asar so it can be loaded and signed like any other Mach-O, ELF or PE file.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { PackageTarget } from "./targets.ts";

/** Where the asar keeps native modules: outside the archive, in `app.asar.unpacked`. */
export const UNPACK_NATIVES = "**/*.node";

/** The platforms sodium-native's patched binding requires by name; any other falls back at runtime. */
const LOADED = new Set(["darwin-arm64", "linux-x64", "linux-arm64", "win32-x64"]);

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** sodium-native's prebuilds by content: each one's digest and its `<platform>-<arch>[-libc]`. */
export const sodiumPrebuilds = (repoRoot: string): ReadonlyMap<string, string> => {
  const fromProtocol = createRequire(join(repoRoot, "packages/protocol/package.json"));
  const universal = dirname(fromProtocol.resolve("sodium-universal/package.json"));

  const native = dirname(
    createRequire(join(universal, "package.json")).resolve("sodium-native/package.json")
  );

  const prebuilds = join(native, "prebuilds");

  return new Map(
    readdirSync(prebuilds).flatMap((platform) =>
      readdirSync(join(prebuilds, platform)).flatMap((name) =>
        name.endsWith(".node") ? [[sha256(join(prebuilds, platform, name)), platform] as const] : []
      )
    )
  );
};

export interface MainNative {
  /** The emitted file's name in `out/main`. */
  readonly file: string;
  /** The prebuild it is a copy of, e.g. `darwin-arm64` or `linux-x64-musl`. */
  readonly platform: string;
}

/** Every `.node` in `mainDir`, named by the prebuild it copies; an unknown one fails the build. */
export const mainNatives = (
  mainDir: string,
  prebuilds: ReadonlyMap<string, string>
): ReadonlyArray<MainNative> =>
  readdirSync(mainDir)
    .filter((file) => file.endsWith(".node"))
    .map((file) => {
      const platform = prebuilds.get(sha256(join(mainDir, file)));

      if (platform === undefined)
        throw new Error(`out/main/${file} is a native module packaging doesn't know`);

      return { file, platform };
    });

const escaped = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Packager `ignore` patterns for the natives `target` doesn't load. A platform the binding
 * requires by name must find its own (glibc, not musl, under Electron), or packaging fails.
 */
export const foreignNatives = (
  natives: ReadonlyArray<MainNative>,
  target: PackageTarget
): RegExp[] => {
  const own = `${target.platform}-${target.arch}`;

  if (LOADED.has(own) && !natives.some((native) => native.platform === own))
    throw new Error(`the main bundle has no sodium-native for ${own}`);

  return natives.flatMap((native) =>
    native.platform === own
      ? []
      : [new RegExp(`[/\\\\]out[/\\\\]main[/\\\\]${escaped(native.file)}$`)]
  );
};
