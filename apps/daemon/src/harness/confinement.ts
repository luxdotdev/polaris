/**
 * Where a read-only session (the Reviewer) may read: its checkout, and for a sandboxed shell
 * also what git needs of the repository and the PATH's tool directories. Each Harness
 * enforces it with its own settings. See docs/adr/0055-the-reviewer-reads-only-its-checkout.md.
 */
import { lstat, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { isWithin } from "../files/fs.ts";
import { gitText } from "../git/git.ts";
import { paths } from "../paths.ts";
import { confinedGit } from "./confinedGit.ts";

export interface ReadConfinement {
  /** The session's checkout, canonical: the only place its file tools may read. */
  readonly root: string;
  /** What a sandboxed shell may read besides `root`. */
  readonly shellRoots: ReadonlyArray<string>;
  /** Never readable by a sandboxed shell, except through `root` and `shellRoots`. */
  readonly denied: ReadonlyArray<string>;
  /** Set in the shell's environment, so its git reads no config that can hold credentials. */
  readonly gitEnv: Readonly<Record<string, string>>;
}

/** The user's git config can name credential helpers and tokens; the Reviewer's git never reads it. */
const NO_USER_GIT_CONFIG = { GIT_CONFIG_GLOBAL: "/dev/null" } as const;

const canonical = (path: string) => realpath(path).catch(() => resolve(path));

const isDirectory = (path: string) =>
  stat(path).then(
    (s) => s.isDirectory(),
    () => false
  );

/** The checkout's own git dir and the repository's common dir, canonical. */
const gitDirs = (root: string) =>
  gitText(root, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"]).then(
    async (output) => {
      const [gitDir, common] = output.split("\n");

      if (gitDir === undefined || common === undefined || gitDir === "" || common === "")
        return null;

      return { gitDir: await canonical(gitDir), common: await canonical(common) };
    },
    () => null
  );

/** Whether either path holds the other: an allowed one may not open up a denied one. */
const overlaps = (a: string, b: string) => isWithin(a, b) || isWithin(b, a);

const unique = (items: ReadonlyArray<string>) => [...new Set(items)];

/** PATH entries that hold tools, never `/` or one inside or above a denied path. */
const toolDirectories = async (pathVariable: string, denied: ReadonlyArray<string>) => {
  const entries = pathVariable.split(delimiter).filter((entry) => isAbsolute(entry));

  const dirs = await Promise.all(
    entries.map(async (entry) => ((await isDirectory(entry)) ? canonical(entry) : null))
  );

  return dirs.filter(
    (dir): dir is string =>
      dir !== null && dir !== "/" && !denied.some((path) => overlaps(dir, path))
  );
};

export const readConfinement = async (
  cwd: string,
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<ReadConfinement> => {
  const root = await canonical(cwd);
  const dirs = await gitDirs(root);
  const outside = dirs !== null && !isWithin(root, dirs.common) ? dirs : null;
  const git = outside === null ? null : await confinedGit(outside.common, outside.gitDir);

  const denied = unique([
    await canonical(homedir()),
    await canonical(paths().root),
    ...(outside === null ? [] : [outside.common]),
  ]);

  const tools = await toolDirectories(env.PATH ?? "", denied);

  return {
    root,
    shellRoots: unique([...(git?.readable ?? []), ...tools]),
    denied,
    gitEnv: { ...NO_USER_GIT_CONFIG, ...git?.env },
  };
};

/** The nearest existing ancestor's real path, with the rest appended: where `path` would land. */
const landing = async (path: string): Promise<string> => {
  const exists = await lstat(path).then(
    () => true,
    () => false
  );

  if (exists) return realpath(path);
  const parent = dirname(path);

  return parent === path ? path : join(await landing(parent), basename(path));
};

/** Whether `input` (relative to `cwd`) stays inside `root`, both as written and once links resolve. */
export const confined = async (root: string, cwd: string, input: string): Promise<boolean> => {
  const lexical = resolve(cwd, input);

  if (!isWithin(root, lexical)) return false;

  return landing(lexical).then(
    (real) => isWithin(root, real),
    () => false
  );
};
