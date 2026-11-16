import { afterEach, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { REPO_ROOT } from "../lib/build.ts";
import { foreignNatives, mainNatives, sodiumPrebuilds } from "./natives.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const prebuilds = sodiumPrebuilds(REPO_ROOT);

const prebuild = (platform: string) => {
  const universal = dirname(
    createRequire(join(REPO_ROOT, "packages/protocol/package.json")).resolve(
      "sodium-universal/package.json"
    )
  );

  const native = dirname(
    createRequire(join(universal, "package.json")).resolve("sodium-native/package.json")
  );

  return join(native, "prebuilds", platform, "sodium-native.node");
};

/** An `out/main` as Bun leaves it: hashed copies of the prebuilds the binding names. */
const mainDir = (platforms: ReadonlyArray<string>) => {
  const root = mkdtempSync(join(tmpdir(), "polaris-natives-"));
  roots.push(root);
  const dir = join(root, "out/main");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.js"), "");

  for (const [i, platform] of platforms.entries())
    copyFileSync(prebuild(platform), join(dir, `sodium-native-${i}abc.node`));

  return dir;
};

const BUNDLED = ["darwin-arm64", "linux-x64-musl", "linux-x64", "win32-x64"];

/** What a target's package keeps of `out/main`'s natives, by the packager's absolute paths. */
const kept = (dir: string, target: Parameters<typeof foreignNatives>[1]) => {
  const ignore = foreignNatives(mainNatives(dir, prebuilds), target);

  return mainNatives(dir, prebuilds)
    .filter(({ file }) => !ignore.some((pattern) => pattern.test(join(dir, file))))
    .map((native) => native.platform);
};

test.each([
  [{ platform: "darwin", arch: "arm64" } as const, ["darwin-arm64"]],
  [{ platform: "linux", arch: "x64" } as const, ["linux-x64"]],
  [{ platform: "win32", arch: "x64" } as const, ["win32-x64"]],
  [{ platform: "win32", arch: "arm64" } as const, []],
])("a %o package keeps only %p", (target, platforms) => {
  expect(kept(mainDir(BUNDLED), target)).toEqual(platforms);
});

test("a platform the binding loads by name fails packaging without its prebuild", () => {
  expect(() =>
    foreignNatives(mainNatives(mainDir(["linux-x64"]), prebuilds), {
      platform: "darwin",
      arch: "arm64",
    })
  ).toThrow("the main bundle has no sodium-native for darwin-arm64");
});

test("a native module that isn't a known prebuild fails packaging", () => {
  const dir = mainDir([]);
  writeFileSync(join(dir, "other-1.node"), "not sodium");

  expect(() => mainNatives(dir, prebuilds)).toThrow(
    "out/main/other-1.node is a native module packaging doesn't know"
  );
});
