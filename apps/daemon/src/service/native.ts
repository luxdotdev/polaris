/**
 * Native libraries that ship next to the compiled `polaris` binary.
 * `bun build --compile` cannot embed a library that is `dlopen`ed at runtime,
 * so `scripts/build-daemon.ts` copies fff's `libfff_c` into each
 * `apps/daemon/dist/<platform>/` beside the binary, and `polaris install`
 * copies it into `~/.polaris/bin/<version>/` with it.
 */
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { isCompiled } from "./platform.ts"

/** Overrides where fff's native library is loaded from (tests, dev builds). */
export const FFF_LIB_ENV = "POLARIS_FFF_LIB"

export const fffLibraryName = (platform: NodeJS.Platform = process.platform): string =>
  platform === "darwin" ? "libfff_c.dylib" : platform === "win32" ? "fff_c.dll" : "libfff_c.so"

/**
 * Where to `dlopen` fff from, in order: `$POLARIS_FFF_LIB`; next to the
 * compiled binary (`dirname(process.execPath)`). Returns null when neither
 * exists, e.g. when running from source: then fall back to the copy that
 * `@ff-labs/fff-node` resolves from its platform package in node_modules.
 */
export const fffLibraryPath = (): string | null => {
  const override = process.env[FFF_LIB_ENV]
  if (override) return override
  if (!isCompiled()) return null
  const beside = join(dirname(process.execPath), fffLibraryName())
  return existsSync(beside) ? beside : null
}

/** Files that must travel with the binary when it is installed or upgraded. */
export const companionFiles = (): ReadonlyArray<string> => [fffLibraryName()]
