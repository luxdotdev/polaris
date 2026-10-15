/**
 * Where a read-only session (the Reviewer) may read: its checkout, and for a sandboxed shell
 * also the repository's git dir and the PATH's tool directories. Each Harness enforces it
 * with its own settings. See docs/adr/0054-the-reviewer-reads-only-its-checkout.md.
 */
import { lstat, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { isWithin } from "../files/fs.ts";
import { gitText } from "../git/git.ts";
import { paths } from "../paths.ts";

export interface ReadConfinement {
  /** The session's checkout, canonical: the only place its file tools may read. */
  readonly root: string;
  /** What a sandboxed shell may read besides `root`. */
  readonly shellRoots: ReadonlyArray<string>;
  /** Never readable by a sandboxed shell, except through `root` and `shellRoots`. */
  readonly denied: ReadonlyArray<string>;
}

/** The user's git config can name credential helpers and tokens; the Reviewer's git never reads it. */
export const CONFINED_GIT_ENV = { GIT_CONFIG_GLOBAL: "/dev/null" } as const;

const canonical = (path: string) => realpath(path).catch(() => resolve(path));

const isDirectory = (path: string) =>
  stat(path).then(
    (s) => s.isDirectory(),
    () => false
  );

const gitCommonDir = (root: string) =>
  gitText(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).then(
    (dir) => canonical(dir),
    () => null
  );

const unique = (items: ReadonlyArray<string>) => [...new Set(items)];

/** PATH entries that hold tools, never one that opens up the home directory or `/`. */
const toolDirectories = async (pathVariable: string, home: string) => {
  const entries = pathVariable.split(delimiter).filter((entry) => isAbsolute(entry));

  const dirs = await Promise.all(
    entries.map(async (entry) => ((await isDirectory(entry)) ? canonical(entry) : null))
  );

  return dirs.filter((dir): dir is string => dir !== null && dir !== "/" && !isWithin(dir, home));
};

export const readConfinement = async (
  cwd: string,
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<ReadConfinement> => {
  const root = await canonical(cwd);
  const home = await canonical(homedir());
  const common = await gitCommonDir(root);
  const tools = await toolDirectories(env.PATH ?? "", home);
  const gitDirs = common === null || isWithin(root, common) ? [] : [common];

  return {
    root,
    shellRoots: unique([...gitDirs, ...tools]),
    denied: unique([home, await canonical(paths().root)]),
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
