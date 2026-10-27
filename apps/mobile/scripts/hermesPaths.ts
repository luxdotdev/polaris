/**
 * Where the Hermes tools live: `hermesc` from the `hermes-compiler` package, and the `hermes` VM
 * that `buildHermes.ts` builds from source at the version React Native ships.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

export const appDir = join(import.meta.dir, "..");

const reactNativeDir = dirname(require.resolve("react-native/package.json"));

/** The Hermes release React Native's prebuilt `hermes-engine` pod is built from. */
export const hermesVersion = (): string => {
  const properties = readFileSync(
    join(reactNativeDir, "sdks", "hermes-engine", "version.properties"),
    "utf8"
  );

  const version = /^HERMES_VERSION_NAME=(.+)$/m.exec(properties)?.[1]?.trim();

  if (version === undefined) throw new Error("react-native names no HERMES_VERSION_NAME");

  return version;
};

export const hermesCacheDir = (version: string): string =>
  join(appDir, "node_modules", ".cache", "hermes", version);

export const hermesVmPath = (version: string): string =>
  join(hermesCacheDir(version), "build", "bin", "hermes");

const hermesPlatform = (): string => {
  if (process.platform === "darwin") return "osx-bin";

  if (process.platform === "win32") return "win64-bin";

  return "linux64-bin";
};

export const hermescPath = (): string =>
  join(
    dirname(require.resolve("hermes-compiler/package.json")),
    "hermesc",
    hermesPlatform(),
    process.platform === "win32" ? "hermesc.exe" : "hermesc"
  );
