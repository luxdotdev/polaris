/**
 * Download the pinned Betterleaks binary for a platform, checked against its
 * pinned SHA-256, into the repo's cache. Used by the Daemon build (which
 * copies it beside `polaris`) and by tests and dev runs from source. Never at
 * run time on a Host: Hosts get the file with the Daemon.
 */
import { childEnv } from "../../service/childEnv.ts";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  BETTERLEAKS_ASSETS,
  BETTERLEAKS_RELEASE,
  BETTERLEAKS_VERSION,
  type BetterleaksAsset,
  betterleaksAsset,
} from "./pin.ts";

const repoRoot = join(import.meta.dir, "..", "..", "..", "..", "..");

/** Where a source checkout keeps the downloaded binary for `asset`. */
export const cachedBetterleaks = (asset: BetterleaksAsset): string =>
  join(
    repoRoot,
    "node_modules",
    ".cache",
    "polaris-betterleaks",
    BETTERLEAKS_VERSION,
    asset,
    "betterleaks"
  );

export const hostAsset = (): BetterleaksAsset | null =>
  betterleaksAsset(`${process.platform}-${process.arch}`);

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const extract = async (archive: string, outDir: string) => {
  const proc = Bun.spawn(["tar", "-xzf", archive, "-C", outDir, "betterleaks"], {
    env: childEnv(),
    stdout: "ignore",
    stderr: "pipe",
  });

  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);

  if (code !== 0) throw new Error(`tar -xzf ${archive} exited ${code}: ${stderr.trim()}`);
};

/** The binary for `asset`, downloading and verifying it first if it isn't cached. */
export const fetchBetterleaks = async (asset: BetterleaksAsset): Promise<string> => {
  const target = cachedBetterleaks(asset);

  if (existsSync(target)) return target;
  const { asset: file, sha256: expected } = BETTERLEAKS_ASSETS[asset];
  const response = await fetch(`${BETTERLEAKS_RELEASE}/${file}`);

  if (!response.ok) throw new Error(`download ${file}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = sha256(bytes);

  if (actual !== expected) {
    throw new Error(`${file}: SHA-256 is ${actual}, the pin says ${expected}`);
  }

  const dir = dirname(target);
  const staging = `${dir}.tmp-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const archive = join(staging, file);
  writeFileSync(archive, bytes);
  await extract(archive, staging);
  rmSync(archive);
  chmodSync(join(staging, "betterleaks"), 0o755);
  mkdirSync(dirname(dir), { recursive: true });
  rmSync(dir, { recursive: true, force: true });
  renameSync(staging, dir);

  return target;
};
