import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { convertVersion, type SquirrelWindowsOptions } from "electron-winstaller";

export const windowsPackageVersion = (version: string, release: boolean): string => {
  if (!/^0\.0\.0(?:[-+].*)?$/.test(version)) return version;

  if (release) throw new Error("Squirrel releases require a version greater than 0.0.0");

  return "0.0.1-dev";
};

export const windowsInstallerOptions = (
  app: string,
  version: string,
  arch: "x64" | "arm64",
  output: string,
  icons: string
): SquirrelWindowsOptions => ({
  appDirectory: app,
  outputDirectory: output,
  name: `Polaris-${arch}-win`,
  title: "Polaris",
  version,
  authors: "lux.dev LLC",
  description: "Polaris Desktop App for Windows (experimental)",
  exe: "Polaris.exe",
  setupExe: `Polaris-${version}-${arch}-win-Setup.exe`,
  setupIcon: join(icons, "Polaris.ico"),
  iconUrl:
    "https://raw.githubusercontent.com/luxdotdev/polaris/main/design/assets/app-icon/Polaris.ico",
  noMsi: true,
  // Publish full packages only; there is no previous-release download during the build.
  noDelta: true,
  fixUpPaths: true,
});

export const verifyWindowsRelease = (output: string, version: string, arch: "x64" | "arm64") => {
  const name = `Polaris-${arch}-win-${convertVersion(version)}-full.nupkg`;
  const bytes = readFileSync(join(output, name));
  const expected = `${createHash("sha1").update(bytes).digest("hex")} ${name} ${bytes.length}`;

  if (
    readFileSync(join(output, "RELEASES"), "utf8").trim().toLowerCase() !== expected.toLowerCase()
  )
    throw new Error("Squirrel RELEASES does not match the full package");

  if (statSync(join(output, `Polaris-${version}-${arch}-win-Setup.exe`)).size === 0)
    throw new Error("empty Windows installer");
};

export const installerWindows = async (
  app: string,
  version: string,
  arch: "x64" | "arm64",
  dist: string,
  icons: string
): Promise<string> => {
  windowsPackageVersion(version, true);
  const output = join(dist, `squirrel-${arch}`);
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  const vendor = mkdtempSync(join(output, ".vendor-"));
  const require = createRequire(import.meta.url);
  const source = join(dirname(require.resolve("electron-winstaller/package.json")), "vendor");

  try {
    cpSync(source, vendor, { recursive: true });
    // Bun does not run the dependency's install script; select the build Host's 7-Zip explicitly.

    for (const extension of ["exe", "dll"])
      cpSync(join(source, `7z-${process.arch}.${extension}`), join(vendor, `7z.${extension}`));
    const { createWindowsInstaller } = await import("electron-winstaller");
    await createWindowsInstaller({
      ...windowsInstallerOptions(app, version, arch, output, icons),
      vendorDirectory: vendor,
    });
    verifyWindowsRelease(output, version, arch);
    writeFileSync(
      join(output, `Polaris-${version}-${arch}-win-RELEASES`),
      readFileSync(join(output, "RELEASES"))
    );

    return output;
  } finally {
    await rm(vendor, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
};
