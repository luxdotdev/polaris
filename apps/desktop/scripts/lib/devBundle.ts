/**
 * macOS dev: `out/dev/Polaris Dev.app`, a clone of node_modules' Electron.app renamed so the
 * app menu, Dock, ⌘⇥ and Activity Monitor say "Polaris Dev", with the dusk icon, re-signed ad hoc.
 * Rebuilt only when Electron, the icon or this patch changes (a stamp beside the bundle).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const DEV_APP_NAME = "Polaris Dev";

const BUNDLE_ID = "dev.lux.polaris.dev";
/** Bump when the patch below changes, so every checkout rebuilds its bundle. */

const PATCH_VERSION = 1;

const HELPERS = ["", " (GPU)", " (Plugin)", " (Renderer)"];

export interface DevBundleInput {
  /** The stock `Electron.app/Contents/MacOS/Electron`. */
  readonly electron: string;
  /** Where the bundle goes: `apps/desktop/out/dev`. */
  readonly outDir: string;
  /** The dusk `PolarisDev.icns`, else the standard icon; null keeps Electron's. */
  readonly icon: string | null;
}

const run = (command: string, args: ReadonlyArray<string>) => {
  const result = spawnSync(command, args, { stdio: ["ignore", "ignore", "pipe"] });

  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} failed: ${String(result.stderr)}`);
};

const plist = (file: string, values: Readonly<Record<string, string>>) => {
  for (const [key, value] of Object.entries(values))
    run("plutil", ["-replace", key, "-string", value, file]);
};

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** What the bundle was built from; a different one means rebuild. */
const stampOf = ({ electron, icon }: DevBundleInput) =>
  JSON.stringify({
    patch: PATCH_VERSION,
    electron,
    plist: sha256(join(dirname(electron), "../Info.plist")),
    icon: icon === null ? null : sha256(icon),
  });

/** Electron finds its helpers by the main executable's name, so they are renamed with it. */
const renameHelpers = (app: string) => {
  const frameworks = join(app, "Contents/Frameworks");

  for (const suffix of HELPERS) {
    const from = join(frameworks, `Electron Helper${suffix}.app`);

    if (!existsSync(from)) continue;
    const name = `${DEV_APP_NAME} Helper${suffix}`;
    const to = join(frameworks, `${name}.app`);

    renameSync(from, to);
    renameSync(
      join(to, "Contents/MacOS", `Electron Helper${suffix}`),
      join(to, "Contents/MacOS", name)
    );
    plist(join(to, "Contents/Info.plist"), {
      CFBundleExecutable: name,
      CFBundleName: name,
      CFBundleIdentifier: `${BUNDLE_ID}.helper`,
    });
  }
};

const build = (input: DevBundleInput, target: string) => {
  const source = join(dirname(input.electron), "../..");

  rmSync(target, { recursive: true, force: true });
  // A clonefile copy on APFS: instant and no extra disk until something changes.
  const cloned = spawnSync("cp", ["-cR", source, target]).status === 0;

  if (!cloned) run("cp", ["-R", source, target]);
  const contents = join(target, "Contents");

  renameSync(join(contents, "MacOS/Electron"), join(contents, "MacOS", DEV_APP_NAME));
  plist(join(contents, "Info.plist"), {
    CFBundleExecutable: DEV_APP_NAME,
    CFBundleName: DEV_APP_NAME,
    CFBundleDisplayName: DEV_APP_NAME,
    CFBundleIdentifier: BUNDLE_ID,
  });
  renameHelpers(target);

  if (input.icon !== null)
    writeFileSync(join(contents, "Resources/electron.icns"), readFileSync(input.icon));
  run("codesign", ["--force", "--deep", "--sign", "-", target]);
};

/** The dev bundle's executable, building or refreshing it first when its stamp is stale. */
export const devBundleBinary = (input: DevBundleInput): string => {
  const app = join(input.outDir, `${DEV_APP_NAME}.app`);
  const binary = join(app, "Contents/MacOS", DEV_APP_NAME);
  const stampFile = join(input.outDir, "stamp.json");
  const stamp = stampOf(input);
  const current = existsSync(stampFile) ? readFileSync(stampFile, "utf8") : null;

  if (current === stamp && existsSync(binary)) return binary;
  mkdirSync(input.outDir, { recursive: true });
  // Built aside, then swapped in, so a concurrent launch never sees half a bundle.
  const staging = join(input.outDir, `.${DEV_APP_NAME}.${process.pid}.app`);

  build(input, staging);
  rmSync(app, { recursive: true, force: true });
  renameSync(staging, app);
  writeFileSync(stampFile, stamp);
  console.log(`dev: built ${app}`);

  return binary;
};
