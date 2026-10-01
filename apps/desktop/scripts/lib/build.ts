/** Build steps shared by `build.ts` and `dev.ts`. */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { APP_DIR, OUT_DIR, REPO_ROOT, stockElectronBinary } from "./electron.ts";
import { prepareDaemonBuilds } from "./daemonBuilds.ts";

export { APP_DIR, electronBinary, OUT_DIR, REPO_ROOT } from "./electron.ts";

const check = (result: Bun.BuildOutput, what: string) => {
  if (result.success) return;

  for (const log of result.logs) console.error(log);

  throw new Error(`${what} build failed`);
};

/** Main (ESM) and preload (CommonJS: sandboxed preloads can't be modules). */
export const buildMain = async (options: { readonly minify?: boolean } = {}) => {
  const common = {
    target: "node" as const,
    external: ["electron"],
    minify: options.minify ?? false,
    sourcemap: "linked" as const,
  };

  check(
    await Bun.build({
      ...common,
      entrypoints: [join(APP_DIR, "src/main/index.ts")],
      outdir: join(OUT_DIR, "main"),
      format: "esm",
    }),
    "main"
  );
  check(
    await Bun.build({
      ...common,
      entrypoints: [join(APP_DIR, "src/preload/index.ts")],
      outdir: join(OUT_DIR, "preload"),
      naming: "[name].cjs",
      format: "cjs",
    }),
    "preload"
  );
};

export const buildRenderer = async () => {
  const { build } = await import("vite");

  await build({ configFile: join(APP_DIR, "vite.config.ts"), logLevel: "warn" });
};

/** Copies Electron.app to `out/Polaris.app` with the built app in `Resources/app`. */
export const bundleApp = async (): Promise<string> => {
  await prepareDaemonBuilds();
  const electronApp = join(dirname(stockElectronBinary()), "../..");
  const target = join(OUT_DIR, "Polaris.app");

  rmSync(target, { recursive: true, force: true });
  cpSync(electronApp, target, { recursive: true, verbatimSymlinks: true });

  const resources = join(target, "Contents/Resources/app");
  cpSync(
    process.env.POLARIS_DESKTOP_DAEMON_DIST ?? join(REPO_ROOT, "apps/daemon/dist"),
    join(target, "Contents/Resources/daemon"),
    { recursive: true }
  );

  mkdirSync(resources, { recursive: true });
  // SAFETY: our own package.json, which always has a version.
  const pkg = (await Bun.file(join(APP_DIR, "package.json")).json()) as { version: string };

  writeFileSync(
    join(resources, "package.json"),
    JSON.stringify(
      {
        name: "polaris",
        productName: "Polaris",
        version: pkg.version,
        type: "module",
        main: "out/main/index.js",
      },
      null,
      2
    )
  );

  for (const dir of ["main", "preload", "renderer"]) {
    cpSync(join(OUT_DIR, dir), join(resources, "out", dir), { recursive: true });
  }

  const plist = join(target, "Contents/Info.plist");

  for (const key of ["CFBundleName", "CFBundleDisplayName"]) {
    Bun.spawnSync(["plutil", "-replace", key, "-string", "Polaris", plist]);
  }

  Bun.spawnSync(["plutil", "-replace", "CFBundleIdentifier", "-string", "dev.lux.polaris", plist]);

  // The generated app icon (design/scripts/gen_app_icon.py) over Electron's.
  const icon = join(REPO_ROOT, "design/assets/app-icon/Polaris.icns");

  if (existsSync(icon)) cpSync(icon, join(target, "Contents/Resources/electron.icns"));

  return target;
};
