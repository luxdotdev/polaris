/**
 * Where git itself found a cwd's repository, and the stat of every path that
 * decided it or holds its config: a cached listing is used only while none changed.
 */
import { realpathSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { type Entry, REPOSITORY_SCOPES } from "./settings.ts";

export interface Located {
  readonly gitDir: string;
  readonly commonDir: string;
  readonly top: string;
}

/** Each of these makes git look elsewhere, or read config from elsewhere: never cached. */
const DISCOVERY_ENV = [
  "GIT_DIR",
  "GIT_COMMON_DIR",
  "GIT_WORK_TREE",
  "GIT_CEILING_DIRECTORIES",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
  "GIT_NAMESPACE",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
];

/** What a directory needs to be a repository to git (`is_git_directory`), or to hold one. */
const BELOW_TOP = [
  ".git",
  ".git/HEAD",
  ".git/objects",
  ".git/refs",
  ".git/commondir",
  "HEAD",
  "objects",
  "refs",
  "commondir",
];

const INCLUDE = /^include(if\..+)?\.path$/;

const stamp = (path: string): string => {
  try {
    const s = statSync(path);

    return s.isDirectory() ? `d${s.ino}` : `f${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
  } catch {
    return "-";
  }
};

export const stampAll = (paths: ReadonlyArray<string>): string => paths.map(stamp).join("|");

/** The cache key, or null when the call's options or environment move git's discovery. */
export const cacheKey = (
  cwd: string,
  options: ReadonlyArray<string>,
  base: Readonly<Record<string, string | undefined>>
): string | null => {
  if (
    options.some(
      (option, i) => option.startsWith("-") && option !== "-c" && options[i - 1] !== "-c"
    )
  ) {
    return null;
  }

  if (DISCOVERY_ENV.some((name) => (base[name] ?? "") !== "")) return null;

  const env = Object.entries(base)
    .filter(
      ([name]) => name.startsWith("GIT_CONFIG") || name === "HOME" || name === "XDG_CONFIG_HOME"
    )
    .sort(([a], [b]) => a.localeCompare(b));

  return JSON.stringify([cwd, options, env]);
};

const isWithin = (dir: string, top: string) => dir === top || dir.startsWith(top + sep);

/** Every directory from `cwd` up to (not including) `top`: where git looked first and moved on. */
const levelsBelow = (cwd: string, top: string): Array<string> => {
  const levels: Array<string> = [];

  for (let dir = cwd; dir !== top; dir = dirname(dir)) levels.push(dir);

  return levels;
};

/**
 * The paths that decided `found` and hold its config, or null when it isn't a plain
 * repository with `cwd` in its work tree (a bare one, `core.worktree`): no cache.
 */
export const discoveryPaths = (cwd: string, found: Located): ReadonlyArray<string> | null => {
  let real: string;

  try {
    real = realpathSync(cwd);
  } catch {
    return null;
  }

  const { gitDir, commonDir, top } = found;
  const dotGit = join(top, ".git");

  if (!isWithin(real, top) || (stamp(dotGit).startsWith("d") && dotGit !== gitDir)) return null;

  return [
    ...levelsBelow(real, top).flatMap((dir) => BELOW_TOP.map((name) => join(dir, name))),
    dotGit,
    ...["HEAD", "objects", "refs", "commondir", "config.worktree"].map((name) =>
      join(gitDir, name)
    ),
    join(commonDir, "config"),
  ];
};

/**
 * The Host's own config files `listing` came from, or null when the repository's
 * entries came from anywhere but its two config files (an include): no cache.
 */
export const hostFiles = (
  found: Located,
  listing: ReadonlyArray<Entry>
): ReadonlyArray<string> | null => {
  const own = new Set([join(found.commonDir, "config"), join(found.gitDir, "config.worktree")]);

  // git names its own config relative to the top level, where it runs.
  const file = (e: Entry) =>
    e.origin.startsWith("file:") ? resolve(found.top, e.origin.slice(5)) : null;

  const ownFilesOnly = listing.every(
    (e) => !REPOSITORY_SCOPES.has(e.scope) || (!INCLUDE.test(e.key) && own.has(file(e) ?? ""))
  );

  if (!ownFilesOnly) return null;

  const files = new Set<string>();

  for (const e of listing) {
    const path = REPOSITORY_SCOPES.has(e.scope) ? null : file(e);

    if (path !== null) files.add(path);
  }

  return [...files];
};
