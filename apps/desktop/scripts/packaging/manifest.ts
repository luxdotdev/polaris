import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PLATFORMS } from "@polaris/client/install";
import { Schema } from "effect";
import { type Run, run } from "./command.ts";
import type { Signing } from "./release.ts";

const FileEntry = Schema.Struct({
  sha256: Schema.String,
  size: Schema.Number,
  executable: Schema.optional(Schema.Boolean),
});

const Embedded = Schema.Struct({
  package: Schema.String,
  version: Schema.String,
  embedded: Schema.Boolean,
});

const Manifest = Schema.Struct({
  version: Schema.String,
  commit: Schema.String,
  fff: Embedded,
  astGrep: Embedded,
  betterleaks: Schema.Struct({ version: Schema.String, file: Schema.String }),
  platforms: Schema.Record(
    Schema.String,
    Schema.Struct({
      target: Schema.String,
      binary: Schema.String,
      sha256: Schema.String,
      files: Schema.Record(Schema.String, FileEntry),
    })
  ),
});

const decodeManifest = Schema.decodeUnknownSync(Schema.fromJsonString(Manifest));

const readManifest = (dist: string) =>
  decodeManifest(readFileSync(join(dist, "manifest.json"), "utf8"));

const fileFacts = (path: string) => ({
  sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  size: statSync(path).size,
});

const verifyRelease = (manifest: typeof Manifest.Type, version: string): void => {
  if (manifest.version !== version)
    throw new Error(
      `Daemon manifest version ${manifest.version} does not match release ${version}`
    );

  for (const platform of PLATFORMS) {
    if (!manifest.platforms[platform]) throw new Error(`release Daemon missing ${platform}`);
  }
};

export const verifyDaemonManifest = (dist: string, version?: string): void => {
  const manifest = readManifest(dist);

  if (version !== undefined) verifyRelease(manifest, version);

  for (const [platform, build] of Object.entries(manifest.platforms)) {
    if (build.sha256 !== build.files[build.binary]?.sha256)
      throw new Error(`${platform}: binary SHA differs from files entry`);

    for (const [name, entry] of Object.entries(build.files)) {
      const facts = fileFacts(join(dist, platform, name));

      if (facts.sha256 !== entry.sha256 || facts.size !== entry.size)
        throw new Error(`${platform}/${name}: bytes differ from Daemon manifest`);
    }
  }
};

export const signDaemonBuilds = (
  dist: string,
  signing: Signing | null,
  entitlementsDir: string,
  execute: Run = run
): void => {
  verifyDaemonManifest(dist);

  if (signing === null) return;

  const manifest = readManifest(dist);
  const build = manifest.platforms["darwin-arm64"];

  if (!build || build.binary !== "polaris" || !build.files.polaris || !build.files.betterleaks)
    throw new Error("missing darwin-arm64 polaris or betterleaks");

  const files = { ...build.files };

  for (const name of ["polaris", "betterleaks"]) {
    const binary = join(dist, "darwin-arm64", name);

    execute([
      "codesign",
      "--force",
      "--sign",
      signing.identity,
      "--options",
      "runtime",
      "--timestamp",
      ...(signing.keychain ? ["--keychain", signing.keychain] : []),
      "--entitlements",
      join(entitlementsDir, name === "polaris" ? "daemon.plist" : "betterleaks.plist"),
      binary,
    ]);
    execute(["codesign", "--verify", "--strict", binary]);
    files[name] = { ...files[name]!, ...fileFacts(binary) };
  }

  const binary = join(dist, "darwin-arm64", "polaris");
  const output = execute([binary, "selftest"]).trim();

  if (output.split("\n")[0] !== `polaris ${manifest.version} darwin-arm64`)
    throw new Error("signed Daemon selftest did not report the expected version and platform");

  execute([join(dist, "darwin-arm64", "betterleaks"), "version"]);

  const signedManifest = {
    ...manifest,
    platforms: {
      ...manifest.platforms,
      "darwin-arm64": { ...build, sha256: files.polaris!.sha256, files },
    },
  };

  writeFileSync(join(dist, "manifest.json"), `${JSON.stringify(signedManifest, null, 2)}\n`);
  verifyDaemonManifest(dist);
};
