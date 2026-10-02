#!/usr/bin/env bun
/**
 * Packages the Desktop App with @electron/packager: `out/dist/Polaris-darwin-arm64/Polaris.app`
 * (and, with `--linux`, `Polaris-linux-x64/`), appId `dev.lux.polaris`, the generated app
 * icon, and every Daemon build in `Resources/daemon` (see src/main/machines/README.md).
 * Signs and notarises when Apple credentials are provided (README, Packaging).
 *
 *   bun scripts/package.ts                 this Mac (darwin arm64)
 *   bun scripts/package.ts --linux         …and Linux x64
 *   bun scripts/package.ts --reuse-daemon  keep apps/daemon/dist as it is
 *   bun scripts/package.ts --release       matching release versions, fresh Daemons
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { packager } from "@electron/packager";
import { Schema } from "effect";
import { APP_DIR, buildMain, buildRenderer, OUT_DIR, REPO_ROOT } from "./lib/build.ts";
import {
  assertReleaseVersions,
  daemonBuildCommand,
  macSigningOptions,
  resolveSigning,
  signDaemonBuilds,
  signingCredentials,
  updateZip,
  verifyDaemonManifest,
} from "./packaging/index.ts";
import { run } from "./packaging/command.ts";

const args = process.argv.slice(2);

const started = performance.now();

const ICONS = join(REPO_ROOT, "design/assets/app-icon");

const DAEMON_DIST = join(REPO_ROOT, "apps/daemon/dist");

const STAGE = join(OUT_DIR, "package");

const release = args.includes("--release");

const decodePackage = Schema.decodeUnknownSync(
  Schema.Struct({
    version: Schema.String,
    devDependencies: Schema.Record(Schema.String, Schema.String),
  })
);

const pkg = decodePackage(await Bun.file(join(APP_DIR, "package.json")).json());

if (release) {
  const daemon = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.String }))(
    await Bun.file(join(REPO_ROOT, "apps/daemon/package.json")).json()
  );

  assertReleaseVersions(pkg.version, daemon.version, args.includes("--reuse-daemon"));
}

const signing = resolveSigning(signingCredentials(process.env));

const ENTITLEMENTS = join(import.meta.dir, "packaging/entitlements");

console.log(
  signing === null
    ? "no Apple credentials: packaging unsigned"
    : "signing and notarising with Developer ID"
);

if (!existsSync(join(ICONS, "Polaris.icns")))
  throw new Error(
    "no app icon: run `uv run --with numpy --with pillow design/scripts/gen_app_icon.py`"
  );

await buildRenderer();

await buildMain({ minify: true });

if (!args.includes("--reuse-daemon") || !existsSync(join(DAEMON_DIST, "manifest.json")))
  console.log(run(daemonBuildCommand(REPO_ROOT, release)).trim());

verifyDaemonManifest(DAEMON_DIST, release ? pkg.version : undefined);

signDaemonBuilds(DAEMON_DIST, signing, ENTITLEMENTS);

// The app directory holds only what runs: the bundles are self-contained (just `electron`).
rmSync(STAGE, { recursive: true, force: true });

const app = join(STAGE, "app");

const resources = join(STAGE, "resources");

mkdirSync(app, { recursive: true });

mkdirSync(resources, { recursive: true });

for (const dir of ["main", "preload", "renderer"])
  cpSync(join(OUT_DIR, dir), join(app, "out", dir), { recursive: true });

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
    ...macSigningOptions(target.platform === "darwin" ? signing : null, ENTITLEMENTS),
  });

  if (path === undefined) throw new Error(`packager returned no ${target.platform} output`);

  if (target.platform === "darwin") {
    const bundle = join(path, "Polaris.app");

    verifyDaemonManifest(
      join(bundle, "Contents/Resources/daemon"),
      release ? pkg.version : undefined
    );
    console.log(`archived ${updateZip(bundle, pkg.version, join(OUT_DIR, "dist"), signing)}`);
  }

  console.log(`packaged ${path}`);
}

console.log(`package done in ${Math.round((performance.now() - started) / 1000)} s`);
