/**
 * Identity of this Daemon build: its version and the platform it was built
 * for. `polaris version` prints `polaris <version> <platform>`, which the
 * Client and `polaris upgrade` parse with `parseVersionLine`.
 */
import pkg from "../../package.json" with { type: "json" }

/** The platforms the Daemon ships for (ENG-181). */
export const PLATFORMS = ["darwin-arm64", "linux-x64", "linux-arm64"] as const
export type Platform = (typeof PLATFORMS)[number]

/** The `bun build --compile --target` for each platform. */
export const BUN_TARGETS: Record<Platform, string> = {
  "darwin-arm64": "bun-darwin-arm64",
  "linux-x64": "bun-linux-x64",
  "linux-arm64": "bun-linux-arm64",
}

export const VERSION: string = pkg.version

export const isPlatform = (value: string): value is Platform =>
  (PLATFORMS as ReadonlyArray<string>).includes(value)

/** This process's platform, or null when the Daemon does not ship for it. */
export const currentPlatform = (): Platform | null => {
  const id = `${process.platform}-${process.arch}`
  return isPlatform(id) ? id : null
}

export const versionLine = (): string => `polaris ${VERSION} ${process.platform}-${process.arch}`

export interface VersionInfo {
  readonly version: string
  readonly platform: string
}

/** Parses the output of `polaris version`; null if it is not one. */
export const parseVersionLine = (output: string): VersionInfo | null => {
  const match = /^polaris (\S+) (\S+)\s*$/m.exec(output.trim())
  return match ? { version: match[1]!, platform: match[2]! } : null
}

/**
 * Whether this process is a `bun build --compile` binary (its entry module
 * lives in Bun's embedded filesystem) rather than `bun src/main.ts`.
 */
export const isCompiled = (): boolean =>
  Bun.main.startsWith("/$bunfs/") || Bun.main.includes("~BUN")
