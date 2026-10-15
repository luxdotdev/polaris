/**
 * The config every git call the Daemon makes on its own runs with: a Workspace's
 * `.git/config` and hooks are its content, so none of the commands they name may
 * run (docs/adr/0056-automatic-git-runs-no-repository-commands.md).
 */
import { childEnv } from "../../service/childEnv.ts";
import { readBounded } from "../output.ts";
import { cacheKey, discoveryPaths, hostFiles, type Located, stampAll } from "./discovery.ts";
import {
  configEnv,
  type Entry,
  FIXED,
  globalOptions,
  parseListing,
  repositoryOverrides,
  type SafeMode,
} from "./settings.ts";

export { globalOptions, parseListing, repositoryOverrides, safeArgs } from "./settings.ts";

export type { SafeMode } from "./settings.ts";

type Env = Record<string, string | undefined>;

const LISTING_LIMIT = 1024 * 1024;

const decoder = new TextDecoder();

/** git with only the fixed settings: these reads run nothing a config names. */
const read = async (cwd: string, args: ReadonlyArray<string>, base: Env) => {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    env: childEnv({ ...base, ...configEnv(FIXED, base) }),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, code] = await Promise.all([
    readBounded(proc.stdout, LISTING_LIMIT, () => proc.kill("SIGKILL")),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout: stdout === null ? null : decoder.decode(stdout), stderr, code };
};

/** The config git itself reads for this call: its own discovery, env and options. */
const listConfig = async (cwd: string, options: ReadonlyArray<string>, base: Env) => {
  const listed = await read(
    cwd,
    [...options, "config", "--list", "--show-scope", "--show-origin", "-z"],
    base
  );

  // Fails closed: a listing cut short or refused could hide a driver.
  if (listed.stdout === null) {
    throw new Error("This repository's git config is too large to read safely");
  }

  if (listed.code !== 0) {
    throw new Error(`git could not read this repository's config: ${listed.stderr.trim()}`);
  }

  return parseListing(listed.stdout);
};

/** Where git finds the repository from `cwd`; null outside one, or in a bare one. */
const locate = async (cwd: string, options: ReadonlyArray<string>, base: Env) => {
  const flags = ["--path-format=absolute", "--git-dir", "--git-common-dir", "--show-toplevel"];
  const found = await read(cwd, [...options, "rev-parse", ...flags], base);
  const [gitDir, commonDir, top] = (found.stdout ?? "").split("\n");

  if (found.code !== 0 || !gitDir || !commonDir || !top) return null;

  return { gitDir, commonDir, top } satisfies Located;
};

interface Cached {
  readonly paths: ReadonlyArray<string>;
  readonly stamps: string;
  readonly listing: ReadonlyArray<Entry>;
}

const cache = new Map<string, Cached>();

const CACHE_SIZE = 64;

/** Stamped before the listing is read, so a change made while it is read shows next time. */
const listAndCache = async (
  cwd: string,
  options: ReadonlyArray<string>,
  base: Env,
  key: string
) => {
  const found = await locate(cwd, options, base);
  const paths = found === null ? null : discoveryPaths(cwd, found);
  const stamps = paths === null ? "" : stampAll(paths);
  const listing = await listConfig(cwd, options, base);

  if (found === null || paths === null) return listing;
  const again = await locate(cwd, options, base);
  const host = hostFiles(found, listing);

  if (JSON.stringify(again) !== JSON.stringify(found) || host === null) return listing;

  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value ?? "");
  cache.set(key, {
    paths: [...paths, ...host],
    stamps: `${stamps}|${stampAll(host)}`,
    listing,
  });

  return listing;
};

const listingFor = async (cwd: string, args: ReadonlyArray<string>, base: Env) => {
  const options = globalOptions(args);
  const key = cacheKey(cwd, options, base);

  if (key === null) return listConfig(cwd, options, base);
  const cached = cache.get(key);

  if (cached !== undefined && stampAll(cached.paths) === cached.stamps) return cached.listing;
  cache.delete(key);

  return listAndCache(cwd, options, base, key);
};

/**
 * The `GIT_CONFIG_*` environment for an automatic git call `args` in `cwd`: the
 * fixed settings, and every command the repository's own config names turned off.
 */
export const safeConfigEnv = async (
  cwd: string,
  base: Env,
  options: { readonly args?: ReadonlyArray<string>; readonly mode?: SafeMode } = {}
) => {
  const listing = await listingFor(cwd, options.args ?? [], base);
  const overrides = repositoryOverrides(listing, options.mode ?? "safe");

  return configEnv([...FIXED, ...overrides], base);
};
