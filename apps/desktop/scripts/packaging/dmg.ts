import { mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { Schema } from "effect";
import { type Run, run } from "./command.ts";
import type { Signing } from "./release.ts";

const decodeSubmission = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ status: Schema.String, id: Schema.String }))
);

export const signDmg = (dmg: string, signing: Signing, execute: Run = run): void => {
  execute([
    "codesign",
    "--force",
    "--timestamp",
    "--sign",
    signing.identity,
    ...(signing.keychain ? ["--keychain", signing.keychain] : []),
    dmg,
  ]);

  execute(["codesign", "--verify", "--strict", dmg]);

  const submission = decodeSubmission(
    execute([
      "xcrun",
      "notarytool",
      "submit",
      dmg,
      "--key",
      signing.appleApiKey,
      "--key-id",
      signing.appleApiKeyId,
      "--issuer",
      signing.appleApiIssuer,
      "--wait",
      "--output-format",
      "json",
    ])
  );

  if (submission.status !== "Accepted")
    throw new Error(`DMG notarisation ${submission.status}: submission ${submission.id}`);

  execute(["xcrun", "stapler", "staple", dmg]);

  execute(["xcrun", "stapler", "validate", dmg]);
};

export const installerDmg = (
  bundle: string,
  version: string,
  outputDir: string,
  assets: string,
  signing: Signing | null,
  execute: Run = run
): string => {
  const filename = `Polaris-${version}-arm64.dmg`;

  if (basename(filename) !== filename || basename(bundle) !== "Polaris.app")
    throw new Error("expected a Polaris.app bundle and a filename-safe version");

  mkdirSync(outputDir, { recursive: true });

  const stage = mkdtempSync(join(outputDir, ".dmg-"));

  const stagedDmg = join(stage, filename);

  const dmg = join(outputDir, filename);

  try {
    if (signing !== null) {
      execute(["codesign", "--verify", "--deep", "--strict", bundle]);

      execute(["xcrun", "stapler", "validate", bundle]);
    }

    execute([
      "uv",
      "run",
      "--locked",
      "--script",
      join(import.meta.dir, "build_dmg.py"),
      bundle,
      assets,
      stagedDmg,
    ]);

    if (signing !== null) signDmg(stagedDmg, signing, execute);

    execute(["hdiutil", "verify", stagedDmg]);

    renameSync(stagedDmg, dmg);

    return dmg;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
};
