#!/usr/bin/env bun
/**
 * Builds the `hermes` VM (not just the compiler) from facebook/hermes at the release React
 * Native ships, into node_modules/.cache/hermes/<version>. Needs git, cmake and ninja.
 *
 *   bun run --cwd apps/mobile hermes:build
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { hermesCacheDir, hermesVersion, hermesVmPath } from "./hermesPaths.ts";

const run = async (command: Array<string>) => {
  console.log(`$ ${command.join(" ")}`);
  const child = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });

  if ((await child.exited) !== 0) throw new Error(`${command[0]} failed`);
};

const version = hermesVersion();

const cache = hermesCacheDir(version);

const source = join(cache, "src");

const build = join(cache, "build");

if (existsSync(hermesVmPath(version))) {
  console.log(`hermes ${version} is already built: ${hermesVmPath(version)}`);
  process.exit(0);
}

mkdirSync(cache, { recursive: true });

if (!existsSync(join(source, "CMakeLists.txt"))) {
  await run([
    "git",
    "clone",
    "--depth=1",
    "--branch",
    `hermes-v${version}`,
    "https://github.com/facebook/hermes.git",
    source,
  ]);
}

await run([
  "cmake",
  "-S",
  source,
  "-B",
  build,
  "-G",
  "Ninja",
  "-DCMAKE_BUILD_TYPE=Release",
  "-DHERMES_ENABLE_TEST_SUITE=OFF",
]);

await run(["ninja", "-C", build, "hermes"]);

console.log(`built ${hermesVmPath(version)}`);
