/**
 * The git the Daemon starts, as an absolute path found on `PATH`: on Windows a bare `git`
 * runs a `git.exe` in the cwd first, the repository (docs/adr/0069-git-runs-by-its-absolute-path.md).
 */
import { resolve } from "node:path";

type Env = Readonly<Record<string, string | undefined>>;

/** git is not on the `PATH` the Daemon would start it with. */
export class GitNotFound extends Error {
  constructor() {
    super("git is not installed, or not on the Daemon's PATH");
  }
}

/** `PATH` as a child would get it; Windows names keep any case (`Path`). */
export const pathOf = (env: Env, os: string = process.platform): string => {
  if (os !== "win32") return env.PATH ?? "";

  const key = Object.keys(env).findLast((k) => k.toLowerCase() === "path");

  return (key === undefined ? undefined : env[key]) ?? "";
};

const found = new Map<string, string>();

/** The absolute path of the git a child with `env` finds on its `PATH`, never one in the cwd. */
export const gitExecutable = (env: Env = process.env): string => {
  // An env without one (repositoryEnv drops Windows' `Path`) looks where Bun.spawn would: the Daemon's.
  const path = pathOf(env) || pathOf(process.env);
  const known = found.get(path);

  if (known !== undefined) return known;

  const which = Bun.which("git", { PATH: path });

  if (which === null) throw new GitNotFound();

  // A `.` entry finds a relative path: resolve it here, not against the repository.
  const absolute = resolve(which);
  found.set(path, absolute);

  return absolute;
};
