/** Paths shared by the build, dev, smoke and bench scripts; runs under Bun and Node. */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "../..");

export const REPO_ROOT = join(APP_DIR, "../..");

export const OUT_DIR = join(APP_DIR, "out");

/** The Electron binary; downloads it first if `bun install` skipped electron's postinstall. */
export const electronBinary = (): string => {
  const require = createRequire(join(APP_DIR, "package.json"));
  const pkgDir = dirname(require.resolve("electron/package.json"));

  if (!existsSync(join(pkgDir, "dist"))) {
    const result = spawnSync("node", [join(pkgDir, "install.js")], { stdio: "inherit" });

    if (result.status !== 0) throw new Error("could not download the Electron binary");
  }

  // SAFETY: electron's main module exports the binary's path as a string.
  return require("electron") as string;
};
