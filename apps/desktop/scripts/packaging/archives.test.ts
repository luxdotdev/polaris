import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBuilds, PLATFORMS, unpackArchive } from "@polaris/client/install";
import {
  bundledPlatforms,
  daemonChecksumsName,
  RELEASE_DIR,
  stageDaemon,
  verifyDaemonArchives,
  verifyDownloadable,
  writeDaemonArchives,
} from "./archives.ts";
import { verifyDaemonManifest } from "./manifest.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const VERSION = "0.1.0-alpha.3";

const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

const fixture = () => {
  const dist = mkdtempSync(join(tmpdir(), "polaris-archives-test-"));
  dirs.push(dist);

  const platforms = Object.fromEntries(
    PLATFORMS.map((platform) => {
      mkdirSync(join(dist, platform));

      const files = Object.fromEntries(
        ["polaris", "betterleaks"].map((name) => {
          const bytes = `${platform}/${name}`;
          writeFileSync(join(dist, platform, name), bytes);

          return [
            name,
            {
              sha256: hash(bytes),
              size: Buffer.byteLength(bytes),
              executable: name === "betterleaks",
            },
          ];
        })
      );

      return [
        platform,
        { target: `bun-${platform}`, binary: "polaris", sha256: files.polaris!.sha256, files },
      ];
    })
  );

  writeFileSync(
    join(dist, "manifest.json"),
    JSON.stringify({
      version: VERSION,
      commit: "commit",
      fff: { package: "fff", version: "1", embedded: true },
      astGrep: { package: "ast-grep", version: "1", embedded: true },
      betterleaks: { version: "1", file: "betterleaks" },
      platforms,
    })
  );

  return dist;
};

const stage = (dist: string, bundled: Parameters<typeof stageDaemon>[2]) => {
  const dest = join(dist, "staged", "daemon");
  stageDaemon(dist, dest, bundled);

  return dest;
};

describe("release Daemon archives", () => {
  test("one archive per platform with the manifest's files, a checksums file, and the download URL", () => {
    const dist = fixture();
    const assets = writeDaemonArchives(dist);

    expect(assets.map((path) => path.split("/").at(-1))).toEqual([
      ...PLATFORMS.map((platform) => `polaris-daemon-${VERSION}-${platform}.tar.gz`),
      daemonChecksumsName(VERSION),
    ]);
    const sums = readFileSync(join(dist, RELEASE_DIR, daemonChecksumsName(VERSION)), "utf8");
    expect(sums.trim().split("\n")).toHaveLength(PLATFORMS.length);

    for (const build of loadBuilds(dist)) {
      expect(build.archive?.url).toBe(
        `https://polaris.lux.dev/api/daemon/${VERSION}/${build.platform}`
      );
      const bytes = readFileSync(join(dist, RELEASE_DIR, build.archive!.name));
      expect(hash(bytes)).toBe(build.archive!.sha256);
      expect(sums).toContain(`${build.archive!.sha256}  ${build.archive!.name}`);
      const entries = unpackArchive(bytes);
      expect(entries.map((e) => [e.name, e.mode])).toEqual([
        ["polaris", 0o755],
        ["betterleaks", 0o755],
      ]);

      for (const file of build.files)
        expect(hash(Buffer.from(entries.find((e) => e.name === file.name)!.bytes))).toBe(
          file.sha256
        );
    }

    verifyDaemonArchives(dist);
  });

  test("a tampered archive or a dev manifest is refused", () => {
    const dist = fixture();
    expect(() => verifyDownloadable(dist)).toThrow("no download URL");
    writeDaemonArchives(dist);
    writeFileSync(join(dist, RELEASE_DIR, `polaris-daemon-${VERSION}-linux-x64.tar.gz`), "x");
    expect(() => verifyDaemonArchives(dist)).toThrow("linux-x64: archive bytes differ");
  });
});

describe("staging the app's Daemon", () => {
  test("a release Mac bundles only darwin-arm64 and still lists every platform", () => {
    const dist = fixture();
    writeDaemonArchives(dist);
    const dest = stage(dist, bundledPlatforms({ platform: "darwin", arch: "arm64" }, true));

    expect(readdirSync(dest).sort()).toEqual(["darwin-arm64", "manifest.json"]);
    verifyDaemonManifest(dest, VERSION);
    verifyDownloadable(dest);
    const builds = loadBuilds(dest);
    expect(builds.map((b) => b.platform)).toEqual([...PLATFORMS]);
    expect(builds.filter((b) => b.bundled).map((b) => b.platform)).toEqual(["darwin-arm64"]);
    expect(builds.every((b) => b.archive !== null)).toBe(true);
  });

  test("a release Windows app bundles no Daemon files, only the manifest", () => {
    const dist = fixture();
    writeDaemonArchives(dist);
    const dest = stage(dist, bundledPlatforms({ platform: "win32", arch: "x64" }, true));

    expect(readdirSync(dest)).toEqual(["manifest.json"]);
    verifyDaemonManifest(dest, VERSION);
    expect(loadBuilds(dest).some((b) => b.bundled)).toBe(false);
  });

  test("dev builds bundle every platform and keep the manifest as built", () => {
    const dist = fixture();
    const dest = stage(dist, bundledPlatforms({ platform: "darwin", arch: "arm64" }, false));

    expect(readdirSync(dest).sort()).toEqual([...PLATFORMS, "manifest.json"].sort());
    expect(readFileSync(join(dest, "manifest.json"))).toEqual(
      readFileSync(join(dist, "manifest.json"))
    );
    expect(loadBuilds(dest).every((b) => b.bundled && b.archive === null)).toBe(true);
    expect(existsSync(join(dest, RELEASE_DIR))).toBe(false);
  });

  test("the release archives never enter the app", () => {
    const dist = fixture();
    writeDaemonArchives(dist);

    expect(existsSync(join(stage(dist, ["darwin-arm64"]), RELEASE_DIR))).toBe(false);
  });
});
