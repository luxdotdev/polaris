/**
 * koffi in a Windows x64 package, for the local pipe's owner check (ADR 0062): its JavaScript
 * under the app's `node_modules/koffi`, and its native module outside the asar as
 * `resources/koffi/win32_x64/koffi.node`, one of the places koffi looks in Electron.
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** The files koffi's CommonJS entry loads, besides the native module. */
const KOFFI_FILES = [
  "package.json",
  "LICENSE.txt",
  "index.cjs",
  "src/koffi/index.cjs",
  "src/koffi/src/static.cjs",
];

/** Where koffi and its win32-x64 build are installed (from `packages/client`, which uses it). */
export const koffiSources = (repoRoot: string) => {
  const fromClient = createRequire(join(repoRoot, "packages/client/package.json"));
  const koffi = dirname(fromClient.resolve("koffi/package.json"));
  const fromKoffi = createRequire(join(koffi, "package.json"));
  let native: string;

  try {
    native = join(
      dirname(fromKoffi.resolve("@koromix/koffi-win32-x64/package.json")),
      "win32_x64/koffi.node"
    );
  } catch {
    throw new Error(
      "koffi's win32-x64 build isn't installed: package on Windows x64, or run `bun install --os win32 --cpu x64`"
    );
  }

  return { koffi, native };
};

/** Copies koffi's JavaScript into `app` and its native module under `resources`; returns that dir. */
export const stageKoffi = (repoRoot: string, app: string, resources: string): string => {
  const { koffi, native } = koffiSources(repoRoot);

  for (const file of KOFFI_FILES) {
    const from = join(koffi, file);

    if (!existsSync(from)) throw new Error(`koffi changed shape: no ${file}`);
    mkdirSync(dirname(join(app, "node_modules/koffi", file)), { recursive: true });
    cpSync(from, join(app, "node_modules/koffi", file));
  }

  const out = join(resources, "koffi");
  mkdirSync(join(out, "win32_x64"), { recursive: true });
  cpSync(native, join(out, "win32_x64/koffi.node"));

  return out;
};
