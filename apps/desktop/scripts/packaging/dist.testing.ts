/**
 * A Daemon build directory for the packaging tests: every platform's `polaris`
 * and `betterleaks` plus the manifest that describes them.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLATFORMS } from "@polaris/client/install";

export const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

const dists: string[] = [];

/** Removes every directory `daemonDist` made; call it from `afterEach`. */
export const removeDists = () => {
  for (const dir of dists.splice(0)) rmSync(dir, { recursive: true, force: true });
};

const platformFiles = (dist: string, platform: string) =>
  Object.fromEntries(
    ["polaris", "betterleaks"].map((name) => {
      const bytes = `${platform}/${name}`;
      writeFileSync(join(dist, platform, name), bytes);

      return [
        name,
        { sha256: hash(bytes), size: Buffer.byteLength(bytes), executable: name === "betterleaks" },
      ];
    })
  );

export const daemonDist = (version: string) => {
  const dist = mkdtempSync(join(tmpdir(), "polaris-dist-test-"));
  dists.push(dist);

  const platforms = Object.fromEntries(
    PLATFORMS.map((platform) => {
      mkdirSync(join(dist, platform));
      const files = platformFiles(dist, platform);

      return [
        platform,
        {
          target: `bun-${platform}`,
          binary: "polaris",
          sha256: hash(`${platform}/polaris`),
          files,
        },
      ];
    })
  );

  writeFileSync(
    join(dist, "manifest.json"),
    JSON.stringify({
      version,
      commit: "commit",
      fff: { package: "fff", version: "1", embedded: true },
      astGrep: { package: "ast-grep", version: "1", embedded: true },
      betterleaks: { version: "1", file: "betterleaks" },
      platforms,
    })
  );

  return dist;
};
