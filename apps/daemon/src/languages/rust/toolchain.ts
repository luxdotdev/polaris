import { access, opendir, readFile, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Option, Schema } from "effect";

/** The Host's own Rust toolchain: binaries called directly, never through rustup's proxies. */
export interface RustToolchain {
  readonly sysroot: string;
  readonly cargo: string;
  readonly rustc: string;
  readonly rustfmt: string | null;
  readonly rustSrc: string | null;
}

export interface RustToolchainOptions {
  readonly home?: string;
  readonly rustupHome?: string;
  readonly directories?: readonly string[];
  readonly settingsFallbacks?: readonly string[];
}

const RustupSettings = Schema.Struct({ default_toolchain: Schema.optionalKey(Schema.String) });

const executable = async (path: string) => {
  try {
    if (!(await stat(path)).isFile()) return null;
    await access(path, constants.X_OK);

    return path;
  } catch {
    return null;
  }
};

const directory = async (path: string) => {
  try {
    return (await stat(path)).isDirectory() ? path : null;
  } catch {
    return null;
  }
};

/** rustup reads its own settings, then a fallback file such as Homebrew's or `/etc/rustup`. */
const SETTINGS_FALLBACKS = [
  "/opt/homebrew/etc/rustup/settings.toml",
  "/usr/local/etc/rustup/settings.toml",
  "/etc/rustup/settings.toml",
];

async function defaultName(path: string) {
  try {
    const text = await readFile(path, "utf8");

    if (text.length > 65536) return undefined;

    return Option.getOrUndefined(Schema.decodeUnknownOption(RustupSettings)(Bun.TOML.parse(text)))
      ?.default_toolchain;
  } catch {
    return undefined;
  }
}

async function rustupDefault(rustupHome: string, fallbacks: readonly string[]) {
  let name = await defaultName(join(rustupHome, "settings.toml"));

  for (const fallback of fallbacks) name ??= await defaultName(fallback);

  if (name === undefined || !/^[A-Za-z0-9._-]+$/.test(name)) return null;
  const toolchains = join(rustupHome, "toolchains");

  if ((await directory(join(toolchains, name))) !== null) return join(toolchains, name);
  let count = 0;

  try {
    for await (const entry of await opendir(toolchains)) {
      if (++count > 64) break;

      if (entry.name.startsWith(`${name}-`)) return join(toolchains, entry.name);
    }
  } catch {
    return null;
  }

  return null;
}

/** A packaged rustc (Homebrew, apt): its realpath is rustc itself, not a rustup proxy. */
async function packagedSysroot(directories: readonly string[]) {
  for (const candidate of directories.slice(0, 16)) {
    try {
      const path = await realpath(join(candidate, "rustc"));

      if (basename(path) !== "rustc") continue;
      const sysroot = dirname(dirname(path));

      if ((await directory(join(sysroot, "lib/rustlib"))) !== null) return sysroot;
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Reads files only: rustup's default toolchain, else a packaged rustc in standard places. Nothing
 * runs and no Workspace file (rust-toolchain.toml, .cargo/config.toml) is consulted.
 */
export async function findRustToolchain(
  options: RustToolchainOptions = {}
): Promise<RustToolchain | null> {
  const home = options.home ?? homedir();
  const rustupHome = options.rustupHome ?? process.env.RUSTUP_HOME ?? join(home, ".rustup");

  const sysroot =
    (await rustupDefault(rustupHome, options.settingsFallbacks ?? SETTINGS_FALLBACKS)) ??
    (await packagedSysroot(
      options.directories ?? ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
    ));

  if (sysroot === null) return null;
  const cargo = await executable(join(sysroot, "bin/cargo"));
  const rustc = await executable(join(sysroot, "bin/rustc"));

  if (cargo === null || rustc === null) return null;

  return {
    sysroot,
    cargo,
    rustc,
    rustfmt: await executable(join(sysroot, "bin/rustfmt")),
    rustSrc: await directory(join(sysroot, "lib/rustlib/src/rust/library")),
  };
}
