import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Options, PackagerOsxSignOptions } from "@electron/packager";
import { type Run, run } from "./command.ts";

const REQUIRED = [
  "APPLE_TEAM_ID",
  "APPLE_API_KEY",
  "APPLE_API_KEY_ID",
  "APPLE_API_ISSUER",
] as const;

const OPTIONAL = [
  "MACOS_CERT_P12",
  "MACOS_CERT_PASSWORD",
  "MACOS_SIGNING_IDENTITY",
  "MACOS_KEYCHAIN",
];

export const signingCredentials = (env: Readonly<Record<string, string | undefined>>) => {
  if (![...REQUIRED, ...OPTIONAL].some((name) => env[name]?.trim())) return null;

  const missing = REQUIRED.filter((name) => !env[name]?.trim());

  if (missing.length > 0)
    throw new Error(`incomplete signing credentials: missing ${missing.join(", ")}`);

  return {
    teamId: env.APPLE_TEAM_ID!,
    appleApiKey: env.APPLE_API_KEY!,
    appleApiKeyId: env.APPLE_API_KEY_ID!,
    appleApiIssuer: env.APPLE_API_ISSUER!,
    identity: env.MACOS_SIGNING_IDENTITY,
    keychain: env.MACOS_KEYCHAIN,
  };
};

export type SigningCredentials = NonNullable<ReturnType<typeof signingCredentials>>;

export type Signing = SigningCredentials & { readonly identity: string };

export const selectIdentity = (credentials: SigningCredentials, output: string): string => {
  const matches = [
    ...output.matchAll(/\b([0-9A-Fa-f]{40}) "(Developer ID Application: [^"\n]+)"/g),
  ].filter(
    ([, hash, name]) =>
      name!.endsWith(`(${credentials.teamId})`) &&
      (!credentials.identity || credentials.identity === name || credentials.identity === hash)
  );

  if (matches.length !== 1)
    throw new Error(
      "expected one valid Developer ID Application identity for APPLE_TEAM_ID; select with MACOS_SIGNING_IDENTITY"
    );

  return matches[0]![1]!;
};

export const resolveSigning = (
  credentials: SigningCredentials | null,
  execute: Run = run
): Signing | null => {
  if (credentials === null) return null;

  if (process.platform !== "darwin") throw new Error("signing requires macOS");

  if (!existsSync(credentials.appleApiKey))
    throw new Error("APPLE_API_KEY must be a path to the .p8 API key file");

  const output = execute([
    "security",
    "find-identity",
    "-v",
    "-p",
    "codesigning",
    ...(credentials.keychain ? [credentials.keychain] : []),
  ]);

  return { ...credentials, identity: selectIdentity(credentials, output) };
};

// Preserve the already signed tools and the manifest hashes used for remote Host installs.
export const preserveDaemonSignature = (path: string): boolean =>
  /\/Contents\/Resources\/daemon(?:\/|$)/.test(path);

export const macSigningOptions = (
  signing: Signing | null,
  entitlementsDir: string
): Pick<Options, "osxSign" | "osxNotarize"> => {
  if (signing === null) return {};

  const osxSign: PackagerOsxSignOptions = {
    identity: signing.identity,
    continueOnError: false,
    ignore: preserveDaemonSignature,
    optionsForFile: () => ({
      hardenedRuntime: true,
      entitlements: join(entitlementsDir, "electron.plist"),
    }),
  };

  return {
    osxSign: signing.keychain ? { ...osxSign, keychain: signing.keychain } : osxSign,
    osxNotarize: {
      appleApiKey: signing.appleApiKey,
      appleApiKeyId: signing.appleApiKeyId,
      appleApiIssuer: signing.appleApiIssuer,
    },
  };
};

export const assertReleaseVersions = (desktop: string, daemon: string, reuse: boolean) => {
  if (desktop !== daemon)
    throw new Error(`release version mismatch: Desktop App ${desktop}, Daemon ${daemon}`);

  if (reuse)
    throw new Error("--reuse-daemon cannot be used with --release; rebuild every release Daemon");
};

export const daemonBuildCommand = (root: string, release: boolean): string[] => [
  process.execPath,
  join(root, "scripts/build-daemon.ts"),
  ...(release ? ["--release"] : []),
];

export const updateZip = (
  bundle: string,
  version: string,
  outputDir: string,
  signing: Signing | null,
  execute: Run = run
): string => {
  if (signing !== null) {
    execute(["codesign", "--verify", "--deep", "--strict", bundle]);
    // @electron/notarize has already stapled the app before packager returns.
    execute(["xcrun", "stapler", "validate", bundle]);
  }

  const zip = join(outputDir, `Polaris-${version}-arm64-mac.zip`);
  execute(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", bundle, zip]);

  return zip;
};
