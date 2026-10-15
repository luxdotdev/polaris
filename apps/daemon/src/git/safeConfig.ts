/**
 * The config every git call the Daemon makes on its own runs with: a Workspace's
 * `.git/config` and hooks are its content, so none of the commands they name may
 * run (docs/adr/0056-automatic-git-runs-no-repository-commands.md).
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { childEnv } from "../service/childEnv.ts";
import { readBounded } from "./output.ts";

/** Hooks, fsmonitor, signature checks and the `ext::` transport: all of them run commands. */
const FIXED: ReadonlyArray<readonly [string, string]> = [
  ["core.hooksPath", "/dev/null"],
  ["core.fsmonitor", "false"],
  ["log.showSignature", "false"],
  ["protocol.ext.allow", "never"],
];

/** Drivers a repository's own config can name; an empty command turns each one off. */
const DRIVER = /^(filter\..+\.(clean|smudge|process)|merge\..+\.driver)$/;

/** `git lfs install --local` writes these; they run the user's own git-lfs. */
const KNOWN_DRIVERS = new Set([
  "git-lfs clean -- %f",
  "git-lfs smudge -- %f",
  "git-lfs filter-process",
]);

const INCLUDE = /^include(if\..+)?\.path$/;

/** Commands that diff: an external diff or textconv driver would otherwise run. */
const DIFFING = new Set(["diff", "log", "show"]);

/** `args` with `--no-ext-diff --no-textconv` right after a diffing subcommand. */
export const withoutDiffDrivers = (args: ReadonlyArray<string>): ReadonlyArray<string> => {
  let i = 0;

  while (i < args.length && args[i]?.startsWith("-") === true) {
    i += args[i] === "-c" || args[i] === "-C" ? 2 : 1;
  }

  const command = args[i];

  if (command === undefined || !DIFFING.has(command)) return args;

  return [...args.slice(0, i + 1), "--no-ext-diff", "--no-textconv", ...args.slice(i + 1)];
};

interface Listed {
  readonly overrides: ReadonlyArray<readonly [string, string]>;
  /** False when the repository's config includes other files, which aren't watched. */
  readonly cacheable: boolean;
}

/** Parses `git config --list --show-scope -z`: `scope NUL key LF value NUL`. */
export const repositoryDrivers = (listing: string): Listed => {
  const fields = listing.split("\0");
  const overrides: Array<readonly [string, string]> = [];
  let cacheable = true;

  for (let i = 0; i + 1 < fields.length; i += 2) {
    const scope = fields[i];
    const entry = fields[i + 1] ?? "";

    if (scope !== "local" && scope !== "worktree") continue;
    const newline = entry.indexOf("\n");
    const key = newline === -1 ? entry : entry.slice(0, newline);
    const value = newline === -1 ? "" : entry.slice(newline + 1);

    if (INCLUDE.test(key)) cacheable = false;

    if (DRIVER.test(key) && !KNOWN_DRIVERS.has(value)) overrides.push([key, ""]);
  }

  return { overrides, cacheable };
};

const configEnv = (
  pairs: ReadonlyArray<readonly [string, string]>,
  base: Readonly<Record<string, string | undefined>>
) => {
  const start = Number.parseInt(base.GIT_CONFIG_COUNT ?? "0", 10);
  const offset = Number.isNaN(start) || start < 0 ? 0 : start;

  return {
    GIT_CONFIG_COUNT: String(offset + pairs.length),
    ...Object.fromEntries(
      pairs.flatMap(([key, value], i) => [
        [`GIT_CONFIG_KEY_${offset + i}`, key],
        [`GIT_CONFIG_VALUE_${offset + i}`, value],
      ])
    ),
  };
};

const LISTING_LIMIT = 1024 * 1024;

const listConfig = async (cwd: string, base: Record<string, string | undefined>) => {
  const proc = Bun.spawn(["git", "config", "--list", "--show-scope", "-z"], {
    cwd,
    env: childEnv({ ...base, ...configEnv(FIXED, base) }),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });

  const listing = await readBounded(proc.stdout, LISTING_LIMIT, () => proc.kill("SIGKILL"));
  await proc.exited;

  // Fails closed: a listing cut short could hide a driver.
  if (listing === null) throw new Error("This repository's git config is too large to read safely");

  return repositoryDrivers(new TextDecoder().decode(listing));
};

const stamp = (path: string) => {
  try {
    const s = statSync(path);

    return `${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
  } catch {
    return "-";
  }
};

const readTrimmed = (path: string) => {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
};

/** The nearest `.git` up from `cwd`, and the files git reads config from through it. */
const configFiles = (
  cwd: string
): { readonly key: string; readonly files: Array<string> } | null => {
  let dir = resolve(cwd);

  for (;;) {
    const dotGit = join(dir, ".git");

    if (stamp(dotGit) !== "-") {
      const pointer = readTrimmed(dotGit);
      const linked = pointer?.startsWith("gitdir: ") === true;
      const gitDir = linked ? resolve(dir, (pointer ?? "").slice(8)) : dotGit;
      const common = readTrimmed(join(gitDir, "commondir"));
      const commonDir = common === null ? gitDir : resolve(gitDir, common);

      return {
        key: dotGit,
        files: [
          dotGit,
          join(gitDir, "commondir"),
          join(commonDir, "config"),
          join(gitDir, "config.worktree"),
        ],
      };
    }

    const parent = dirname(dir);

    if (parent === dir) return null;
    dir = parent;
  }
};

const cache = new Map<string, { readonly stamps: string; readonly listed: Listed }>();

const CACHE_SIZE = 64;

const driversAt = async (cwd: string, base: Record<string, string | undefined>) => {
  const found = base.GIT_DIR === undefined ? configFiles(cwd) : null;
  const stamps = found?.files.map(stamp).join("|") ?? "";
  const cached = found === null ? undefined : cache.get(found.key);

  if (cached !== undefined && cached.stamps === stamps) return cached.listed;

  const listed = await listConfig(cwd, base);

  if (found !== null && listed.cacheable) {
    if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value ?? "");
    cache.set(found.key, { stamps, listed });
  }

  return listed;
};

/**
 * The `GIT_CONFIG_*` environment for an automatic git call in `cwd`: the fixed
 * settings, and every driver the repository's own config names turned off.
 */
export const safeConfigEnv = async (cwd: string, base: Record<string, string | undefined>) => {
  const { overrides } = await driversAt(cwd, base);

  return configEnv([...FIXED, ...overrides], base);
};
