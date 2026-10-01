#!/usr/bin/env bun
/**
 * Packages the Desktop App with @electron/packager: `out/dist/Polaris-darwin-arm64/Polaris.app`
 * (and, with `--linux`, `Polaris-linux-x64/`), appId `dev.lux.polaris`, the generated app
 * icon, and every Daemon build in `Resources/daemon` (see src/main/machines/README.md).
 * Unsigned: signing and notarisation are a follow-up (README, Packaging).
 *
 *   bun scripts/package.ts                 this Mac (darwin arm64)
 *   bun scripts/package.ts --linux         …and Linux x64
 *   bun scripts/package.ts --reuse-daemon  keep apps/daemon/dist as it is
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { packager } from "@electron/packager";
import { APP_DIR, buildMain, buildRenderer, OUT_DIR, REPO_ROOT } from "./lib/build.ts";

const args = process.argv.slice(2);

const started = performance.now();

const ICONS = join(REPO_ROOT, "design/assets/app-icon");

const DAEMON_DIST = join(REPO_ROOT, "apps/daemon/dist");

const STAGE = join(OUT_DIR, "package");

const run = (cmd: string[], cwd: string) => {
  const result = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" });

  if (result.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed`);
};

if (!existsSync(join(ICONS, "Polaris.icns")))
  throw new Error(
    "no app icon: run `uv run --with numpy --with pillow design/scripts/gen_app_icon.py`"
  );

await buildRenderer();

await buildMain({ minify: true });

if (!args.includes("--reuse-daemon") || !existsSync(join(DAEMON_DIST, "manifest.json")))
  run(["bun", "run", "build"], join(REPO_ROOT, "apps/daemon"));

// The app directory holds only what runs: the bundles are self-contained (just `electron`).
rmSync(STAGE, { recursive: true, force: true });

const app = join(STAGE, "app");

const resources = join(STAGE, "resources");

mkdirSync(app, { recursive: true });

mkdirSync(resources, { recursive: true });

for (const dir of ["main", "preload", "renderer"])
  cpSync(join(OUT_DIR, dir), join(app, "out", dir), { recursive: true });

// SAFETY: our own package.json, which always has these fields.
const pkg = (await Bun.file(join(APP_DIR, "package.json")).json()) as {
  readonly version: string;
  readonly devDependencies: Readonly<Record<string, string>>;
};

writeFileSync(
  join(app, "package.json"),
  JSON.stringify(
    {
      name: "polaris",
      productName: "Polaris",
      version: pkg.version,
      license: "Apache-2.0",
      type: "module",
      main: "out/main/index.js",
    },
    null,
    2
  )
);

cpSync(DAEMON_DIST, join(resources, "daemon"), { recursive: true });

cpSync(join(ICONS, "linux/512x512.png"), join(resources, "icon.png"));

const electronVersion = pkg.devDependencies.electron;

if (electronVersion === undefined) throw new Error("electron is not a devDependency");

const targets: Array<{ platform: "darwin" | "linux"; arch: "arm64" | "x64" }> = [
  { platform: "darwin", arch: "arm64" },
];

if (args.includes("--linux")) targets.push({ platform: "linux", arch: "x64" });

for (const target of targets) {
  const [path] = await packager({
    dir: app,
    out: join(OUT_DIR, "dist"),
    overwrite: true,
    ...target,
    name: "Polaris",
    executableName: target.platform === "linux" ? "polaris" : "Polaris",
    appBundleId: "dev.lux.polaris",
    appCategoryType: "public.app-category.developer-tools",
    appCopyright: "© 2026 lux.dev LLC",
    appVersion: pkg.version,
    electronVersion,
    icon: join(ICONS, "Polaris.icns"),
    extraResource: [join(resources, "daemon"), join(resources, "icon.png")],
    darwinDarkModeSupport: true,
    asar: true,
    prune: false,
    quiet: true,
  });

  console.log(`packaged ${path}`);
}

console.log(`package done in ${Math.round((performance.now() - started) / 1000)} s`);
