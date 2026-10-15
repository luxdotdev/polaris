import { afterEach, describe, expect, test } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unpackArchive } from "@polaris/client/install";
import { REPO_ROOT } from "../lib/build.ts";
import { daemonChecksumsName, RELEASE_DIR, stageDaemon, writeDaemonArchives } from "./archives.ts";
import { daemonDist, removeDists } from "./dist.testing.ts";
import { fileFacts, readManifest, verifyDaemonManifest } from "./manifest.ts";

afterEach(removeDists);

const SIGNER = join(REPO_ROOT, "tooling/release/sign.py");

const ENTITLEMENTS = join(import.meta.dir, "entitlements");

const VERSION = "0.1.0-rc.1";

// Any Mach-O file signs; a copy of a system tool is the smallest at hand.
const MACHO = "/usr/bin/true";

const plist = (keys: Record<string, string>) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>${Object.entries(keys)
    .map(([key, value]) => `<key>${key}</key><string>${value}</string>`)
    .join("")}</dict></plist>\n`;

/** A release dist whose darwin-arm64 tools are real Mach-O files, archived like a release. */
const releaseDist = () => {
  const dist = daemonDist(VERSION);
  const path = join(dist, "manifest.json");
  const manifest = readManifest(dist);
  const build = manifest.platforms["darwin-arm64"]!;
  const files = { ...build.files };

  for (const name of ["polaris", "betterleaks"]) {
    copyFileSync(MACHO, join(dist, "darwin-arm64", name));
    files[name] = { ...files[name]!, ...fileFacts(join(dist, "darwin-arm64", name)) };
  }

  const platforms = {
    ...manifest.platforms,
    "darwin-arm64": { ...build, files, sha256: files.polaris!.sha256 },
  };

  writeFileSync(path, JSON.stringify({ ...manifest, platforms }));
  writeDaemonArchives(dist);

  return dist;
};

const bundle = (path: string, executable: string) => {
  mkdirSync(join(path, "Contents/MacOS"), { recursive: true });
  writeFileSync(
    join(path, "Contents/Info.plist"),
    plist({
      CFBundleExecutable: executable,
      CFBundleIdentifier: `test.${executable.replaceAll(" ", "")}`,
    })
  );
  copyFileSync(MACHO, join(path, "Contents/MacOS", executable));
};

/** The shape of an Electron app: a helper app and a versioned framework with a library. */
const releaseApp = (dist: string) => {
  const app = join(mkdtempSync(join(tmpdir(), "polaris-sign-")), "Polaris.app");
  bundle(app, "Polaris");
  bundle(join(app, "Contents/Frameworks/Polaris Helper.app"), "Polaris Helper");
  const framework = join(app, "Contents/Frameworks/Fake.framework");
  mkdirSync(join(framework, "Versions/A/Resources"), { recursive: true });
  mkdirSync(join(framework, "Versions/A/Libraries"));
  copyFileSync(MACHO, join(framework, "Versions/A/Fake"));
  copyFileSync(MACHO, join(framework, "Versions/A/Libraries/libfake.dylib"));
  writeFileSync(
    join(framework, "Versions/A/Resources/Info.plist"),
    plist({
      CFBundleExecutable: "Fake",
      CFBundleIdentifier: "test.fake",
      CFBundlePackageType: "FMWK",
    })
  );
  symlinkSync("A", join(framework, "Versions/Current"));
  symlinkSync("Versions/Current/Fake", join(framework, "Fake"));
  symlinkSync("Versions/Current/Resources", join(framework, "Resources"));
  mkdirSync(join(app, "Contents/Resources"));
  writeFileSync(join(app, "Contents/Resources/app.asar"), "asar");
  stageDaemon(dist, join(app, "Contents/Resources/daemon"), ["darwin-arm64"]);

  return app;
};

const signer = (...args: string[]) => {
  const result = Bun.spawnSync(["python3", "-I", SIGNER, "--ad-hoc", ...args], {
    env: { PATH: process.env.PATH ?? "" },
  });

  return { ok: result.exitCode === 0, error: result.stderr.toString() };
};

const signApp = (dist: string, app: string, out: string) =>
  signer(
    "app",
    "--dist",
    dist,
    "--app",
    app,
    "--out",
    out,
    "--entitlements",
    ENTITLEMENTS,
    "--version",
    VERSION
  );

/** `codesign --display` facts: the flags line and the entitlements XML. */
const signature = (path: string) => {
  const result = Bun.spawnSync([
    "codesign",
    "--display",
    "--verbose=2",
    "--entitlements",
    "-",
    "--xml",
    path,
  ]);

  return `${result.stderr.toString()}${result.stdout.toString()}`;
};

const verifies = (...args: string[]) =>
  Bun.spawnSync(["codesign", "--verify", "--strict", ...args]).exitCode === 0;

describe.skipIf(process.platform !== "darwin")("the release signer", () => {
  test("re-records the signed Daemon in the manifests, its archive and checksums", () => {
    const dist = releaseDist();
    const app = releaseApp(dist);
    const unsigned = readFileSync(join(dist, "darwin-arm64/polaris"));

    expect(signApp(dist, app, join(app, ".."))).toEqual({ ok: true, error: "" });

    const polaris = readFileSync(join(dist, "darwin-arm64/polaris"));
    expect(polaris.equals(unsigned)).toBe(false);
    expect(signature(join(dist, "darwin-arm64/polaris"))).toContain("(adhoc,runtime)");
    verifyDaemonManifest(dist, VERSION);

    const manifest = readManifest(dist);
    const archive = manifest.platforms["darwin-arm64"]!.archive!;
    const archived = unpackArchive(readFileSync(join(dist, RELEASE_DIR, archive.name)));
    expect(archived.map((entry) => [entry.name, entry.mode])).toEqual([
      ["polaris", 0o755],
      ["betterleaks", 0o755],
    ]);
    expect(Buffer.from(archived[0]!.bytes).equals(polaris)).toBe(true);
    expect(fileFacts(join(dist, RELEASE_DIR, archive.name))).toEqual({
      sha256: archive.sha256,
      size: archive.size,
    });
    expect(readFileSync(join(dist, RELEASE_DIR, daemonChecksumsName(VERSION)), "utf8")).toContain(
      `${archive.sha256}  ${archive.name}\n`
    );

    const staged = join(app, "Contents/Resources/daemon");
    verifyDaemonManifest(staged, VERSION);
    expect(readManifest(staged)).toEqual({ ...manifest, bundled: ["darwin-arm64"] });
  });

  test("signs the app from the inside out, keeping the Daemon's own entitlements", () => {
    const dist = releaseDist();
    const app = releaseApp(dist);
    const out = join(app, "..", "out");

    expect(signApp(dist, app, out).ok).toBe(true);

    expect(verifies("--deep", app)).toBe(true);

    for (const nested of [
      "Contents/Frameworks/Polaris Helper.app",
      "Contents/Frameworks/Fake.framework/Versions/A/Libraries/libfake.dylib",
    ])
      expect(signature(join(app, nested))).toContain("(adhoc,runtime)");
    expect(signature(join(app, "Contents/Resources/daemon/darwin-arm64/polaris"))).toContain(
      "com.apple.security.cs.disable-library-validation"
    );

    const listing = Bun.spawnSync(["unzip", "-l", join(out, `Polaris-${VERSION}-arm64-mac.zip`)]);
    expect(listing.stdout.toString()).toContain("Polaris.app/Contents/MacOS/Polaris");
  });

  test("refuses a Daemon whose bytes differ from its manifest", () => {
    const dist = releaseDist();
    const app = releaseApp(dist);
    writeFileSync(join(dist, "darwin-arm64/betterleaks"), "replaced");

    const { ok, error } = signApp(dist, app, join(app, ".."));

    expect(ok).toBe(false);
    expect(error).toContain("darwin-arm64/betterleaks: bytes differ from the Daemon manifest");
  });

  test("signs the installer image", () => {
    const dist = releaseDist();
    const app = releaseApp(dist);
    const dmg = join(app, "..", "Polaris.dmg");
    Bun.spawnSync(["hdiutil", "create", "-quiet", "-srcfolder", app, "-format", "UDZO", dmg]);

    expect(verifies(dmg)).toBe(false);
    expect(signer("dmg", "--dmg", dmg).ok).toBe(true);
    expect(verifies(dmg)).toBe(true);
  }, 60_000);
});
