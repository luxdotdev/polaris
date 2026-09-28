#!/usr/bin/env bun
/**
 * Build the `polaris` Daemon for every platform it ships on (ENG-181):
 *
 *   apps/daemon/dist/<platform>/polaris          bun build --compile
 *   apps/daemon/dist/<platform>/libfff_c.{dylib,so}  fff's native library
 *   apps/daemon/dist/manifest.json               version + SHA-256 of every file
 *
 * `bun build --compile` cannot embed a library that is dlopen'ed at runtime,
 * so fff's prebuilt library (from the `@ff-labs/fff-bin-*` package matching
 * each platform, MIT) ships beside the binary; the Daemon finds it through
 * `apps/daemon/src/service/native.ts`.
 *
 *   bun scripts/build-daemon.ts [darwin-arm64|linux-x64|linux-arm64 ...]
 */
import { createHash } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const root = join(import.meta.dir, "..")
const daemonDir = join(root, "apps", "daemon")
const distDir = join(daemonDir, "dist")
const cacheDir = join(root, "node_modules", ".cache", "polaris-native")

const PLATFORMS = {
  "darwin-arm64": { target: "bun-darwin-arm64", fff: "darwin-arm64", lib: "libfff_c.dylib" },
  "linux-x64": { target: "bun-linux-x64", fff: "linux-x64-gnu", lib: "libfff_c.so" },
  "linux-arm64": { target: "bun-linux-arm64", fff: "linux-arm64-gnu", lib: "libfff_c.so" },
} as const
type Platform = keyof typeof PLATFORMS

/** Used until the Daemon depends on @ff-labs/fff-node; then its installed version wins. */
const DEFAULT_FFF_VERSION = "0.11.0"

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex")

const run = async (argv: ReadonlyArray<string>, cwd = root) => {
  const proc = Bun.spawn([...argv], { cwd, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(`${argv.join(" ")} exited ${code}\n${stderr || stdout}`)
  return stdout
}

const daemonRequire = createRequire(join(daemonDir, "package.json"))

const fffVersion = (): string => {
  try {
    const pkg = JSON.parse(
      readFileSync(daemonRequire.resolve("@ff-labs/fff-node/package.json"), "utf8"),
    )
    return pkg.version
  } catch {
    return DEFAULT_FFF_VERSION
  }
}

/**
 * The path of fff's library for `platform`: from node_modules when the
 * platform package is installed (the host's own), otherwise from the npm
 * tarball, verified against the registry's SHA-512 integrity and cached.
 */
const fffLibrary = async (platform: Platform, version: string): Promise<string> => {
  const { fff, lib } = PLATFORMS[platform]
  const name = `@ff-labs/fff-bin-${fff}`
  try {
    const fffRequire = createRequire(daemonRequire.resolve("@ff-labs/fff-node/package.json"))
    const pkgJson = fffRequire.resolve(`${name}/package.json`)
    if (JSON.parse(readFileSync(pkgJson, "utf8")).version === version) {
      const local = join(dirname(pkgJson), lib)
      if (existsSync(local)) return local
    }
  } catch {}

  const extracted = join(cacheDir, `fff-bin-${fff}-${version}`)
  const cached = join(extracted, "package", lib)
  if (existsSync(cached)) return cached

  const meta = await fetch(`https://registry.npmjs.org/${name}/${version}`).then((response) => {
    if (!response.ok) throw new Error(`${name}@${version}: registry answered ${response.status}`)
    return response.json() as Promise<{ dist: { tarball: string; integrity: string } }>
  })
  const tarball = new Uint8Array(await (await fetch(meta.dist.tarball)).arrayBuffer())
  const [algorithm, expected] = meta.dist.integrity.split("-", 2) as [string, string]
  const actual = createHash(algorithm).update(tarball).digest("base64")
  if (actual !== expected) throw new Error(`${name}@${version}: integrity mismatch`)
  mkdirSync(extracted, { recursive: true })
  const archive = join(extracted, "package.tgz")
  writeFileSync(archive, tarball)
  await run(["tar", "-xzf", archive, "-C", extracted])
  rmSync(archive)
  if (!existsSync(cached)) throw new Error(`${name}@${version} has no ${lib}`)
  return cached
}

interface FileEntry {
  readonly sha256: string
  readonly size: number
}

const entry = (path: string): FileEntry => ({ sha256: sha256(path), size: statSync(path).size })

const hostPlatform = `${process.platform}-${process.arch}`

/**
 * Bun appends the bundle after linking, which leaves the linker's ad-hoc
 * signature invalid; recent macOS kills such binaries on exec (SIGKILL, exit
 * 137). Re-sign ad hoc. Needs macOS `codesign`, so darwin builds run on macOS.
 */
const signAdHoc = async (binary: string) => {
  if (process.platform !== "darwin") {
    throw new Error("darwin builds must run on macOS (codesign is needed to re-sign the binary)")
  }
  await run(["codesign", "--force", "--sign", "-", binary])
  await run(["codesign", "--verify", "--strict", binary])
}

const build = async (platform: Platform, version: string, fff: string) => {
  const { target, lib } = PLATFORMS[platform]
  const outDir = join(distDir, platform)
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const binary = join(outDir, "polaris")
  await run([
    process.execPath,
    "build",
    join(daemonDir, "src", "main.ts"),
    "--compile",
    `--target=${target}`,
    "--minify",
    `--outfile=${binary}`,
  ])
  if (platform.startsWith("darwin")) await signAdHoc(binary)
  copyFileSync(await fffLibrary(platform, fff), join(outDir, lib))

  if (platform === hostPlatform) {
    const output = (await run([binary, "version"])).trim()
    const expected = `polaris ${version} ${platform}`
    if (output !== expected)
      throw new Error(`${binary} version printed "${output}", not "${expected}"`)
  }

  return {
    target,
    binary: "polaris",
    sha256: sha256(binary),
    files: { polaris: entry(binary), [lib]: entry(join(outDir, lib)) },
  }
}

const main = async () => {
  const requested = process.argv.slice(2)
  const unknown = requested.filter((platform) => !(platform in PLATFORMS))
  if (unknown.length > 0) throw new Error(`unknown platform(s): ${unknown.join(", ")}`)
  const platforms = (requested.length > 0 ? requested : Object.keys(PLATFORMS)) as Array<Platform>

  const version = JSON.parse(readFileSync(join(daemonDir, "package.json"), "utf8"))
    .version as string
  const fff = fffVersion()
  const commit = (await run(["git", "rev-parse", "HEAD"]).catch(() => "unknown")).trim()

  const manifestPath = join(distDir, "manifest.json")
  const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null
  const built: Record<string, unknown> =
    previous?.version === version && previous?.commit === commit ? { ...previous.platforms } : {}

  for (const platform of platforms) {
    const started = performance.now()
    built[platform] = await build(platform, version, fff)
    const seconds = ((performance.now() - started) / 1000).toFixed(1)
    console.log(`built ${platform} in ${seconds}s`)
  }

  const manifest = {
    version,
    commit,
    fff: { package: "@ff-labs/fff-node", version: fff },
    platforms: built,
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`wrote ${manifestPath}`)
}

await main()
