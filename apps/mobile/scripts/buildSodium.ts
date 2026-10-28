#!/usr/bin/env bun
/**
 * Builds libsodium for iOS (device arm64, simulator arm64 and x86_64) as the static
 * `Clibsodium.xcframework` the `PolarisSodium` module links. The release tarball is pinned
 * by SHA-256. Idempotent; `ios` runs it before `expo run:ios`.
 *
 *   bun run --cwd apps/mobile sodium:build
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { appDir } from "./hermesPaths.ts";

const VERSION = "1.0.21";

/** libsodium-1.0.21.tar.gz, whose minisign signature by libsodium.org's key was checked. */
const SHA256 = "9e4285c7a419e82dedb0be63a72eea357d6943bc3e28e6735bf600dd4883feaf";

const URL = `https://download.libsodium.org/libsodium/releases/libsodium-${VERSION}.tar.gz`;

const IOS_MIN = "15.1";

export const xcframeworkPath = join(
  appDir,
  "modules",
  "polaris-sodium",
  "ios",
  "vendor",
  "Clibsodium.xcframework"
);

const cache = join(appDir, "node_modules", ".cache", "libsodium", VERSION);

const run = async (command: Array<string>, cwd: string, env?: Record<string, string>) => {
  const child = Bun.spawn(command, {
    cwd,
    env: { ...process.env, ...env },
    stdout: "ignore",
    stderr: "pipe",
  });

  const stderr = await new Response(child.stderr).text();

  if ((await child.exited) !== 0) throw new Error(`${command.join(" ")} failed:\n${stderr}`);
};

const xcrun = async (args: Array<string>): Promise<string> => {
  const child = Bun.spawn(["xcrun", ...args], { stdout: "pipe", stderr: "inherit" });
  const out = await new Response(child.stdout).text();

  if ((await child.exited) !== 0) throw new Error(`xcrun ${args.join(" ")} failed`);

  return out.trim();
};

const fetchSource = async (): Promise<string> => {
  const source = join(cache, `libsodium-${VERSION}`);

  if (existsSync(join(source, "configure"))) return source;
  mkdirSync(cache, { recursive: true });
  const tarball = new Uint8Array(await (await fetch(URL)).arrayBuffer());
  const digest = new Bun.CryptoHasher("sha256").update(tarball).digest("hex");

  if (digest !== SHA256) throw new Error(`libsodium tarball SHA-256 is ${digest}, not ${SHA256}`);
  writeFileSync(join(cache, "libsodium.tar.gz"), tarball);
  await run(["tar", "xzf", "libsodium.tar.gz"], cache);

  return source;
};

interface Slice {
  readonly name: string;
  readonly sdk: "iphoneos" | "iphonesimulator";
  readonly arch: "arm64" | "x86_64";
}

const SLICES: ReadonlyArray<Slice> = [
  { name: "ios-arm64", sdk: "iphoneos", arch: "arm64" },
  { name: "sim-arm64", sdk: "iphonesimulator", arch: "arm64" },
  { name: "sim-x86_64", sdk: "iphonesimulator", arch: "x86_64" },
];

const buildSlice = async (source: string, slice: Slice): Promise<string> => {
  const prefix = join(cache, "out", slice.name);

  if (existsSync(join(prefix, "lib", "libsodium.a"))) return prefix;
  const sysroot = await xcrun(["--sdk", slice.sdk, "--show-sdk-path"]);
  const min = slice.sdk === "iphoneos" ? "-mios-version-min" : "-mios-simulator-version-min";
  const flags = `-O3 -arch ${slice.arch} -isysroot ${sysroot} ${min}=${IOS_MIN}`;
  const host = slice.arch === "arm64" ? "aarch64-apple-darwin23" : "x86_64-apple-darwin23";

  console.log(`libsodium ${VERSION}: ${slice.name}`);
  await run(["make", "distclean"], source).catch(() => undefined);
  await run(
    [
      "./configure",
      `--host=${host}`,
      `--prefix=${prefix}`,
      "--disable-shared",
      "--enable-static",
      ...(slice.arch === "x86_64" ? ["cross_compiling=yes"] : []),
    ],
    source,
    { CFLAGS: flags, LDFLAGS: flags }
  );
  await run(["make", `-j${cpus().length}`, "install"], source);

  return prefix;
};

const MODULE_MAP = 'module Clibsodium {\n  header "sodium.h"\n  export *\n}\n';

if (process.platform !== "darwin") {
  console.log("libsodium for iOS builds only on macOS; skipped");
  process.exit(0);
}

if (existsSync(xcframeworkPath)) {
  console.log(`libsodium ${VERSION} is already built: ${xcframeworkPath}`);
  process.exit(0);
}

const source = await fetchSource();

const prefixes: Array<string> = [];

// configure and make share the source tree, so the slices build one after another.
for (const slice of SLICES) prefixes.push(await buildSlice(source, slice));

const [device, simArm, simX86] = prefixes;

if (device === undefined || simArm === undefined || simX86 === undefined)
  throw new Error("a libsodium slice is missing");

const simulator = join(cache, "out", "sim-universal");

rmSync(simulator, { recursive: true, force: true });

mkdirSync(join(simulator, "lib"), { recursive: true });

await run(
  [
    "lipo",
    "-create",
    join(simArm, "lib", "libsodium.a"),
    join(simX86, "lib", "libsodium.a"),
    "-output",
    join(simulator, "lib", "libsodium.a"),
  ],
  cache
);

await run(["cp", "-R", join(simArm, "include"), simulator], cache);

for (const prefix of [device, simulator])
  writeFileSync(join(prefix, "include", "module.modulemap"), MODULE_MAP);

mkdirSync(join(xcframeworkPath, ".."), { recursive: true });

await run(
  [
    "xcodebuild",
    "-create-xcframework",
    "-library",
    join(device, "lib", "libsodium.a"),
    "-headers",
    join(device, "include"),
    "-library",
    join(simulator, "lib", "libsodium.a"),
    "-headers",
    join(simulator, "include"),
    "-output",
    xcframeworkPath,
  ],
  cache
);

console.log(`libsodium ${VERSION}: ${xcframeworkPath}`);
