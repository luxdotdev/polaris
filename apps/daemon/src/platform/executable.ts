/**
 * The program a child starts, as an absolute path found on that child's own `PATH`. On Windows
 * a bare name runs a program in the cwd first, a repository (docs/adr/0070-programs-run-by-their-absolute-path.md).
 */
import { statSync } from "node:fs";
import { isAbsolute, resolve, win32 } from "node:path";
import { Schema } from "effect";

type Env = Readonly<Record<string, string | undefined>>;

/** `program` is on no directory of the `PATH` the Daemon would start it with. */
export class ExecutableNotFound extends Schema.TaggedError<ExecutableNotFound>()(
  "ExecutableNotFound",
  { program: Schema.String }
) {
  override get message() {
    return `${this.program} is not installed, or not on the Daemon's PATH`;
  }
}

/** `key` in `env` as a child would get it; Windows names keep any case (`Path`, `PathExt`). */
const valueOf = (env: Env, key: string, os: string): string | undefined => {
  if (os !== "win32") return env[key];
  const lower = key.toLowerCase();
  const name = Object.keys(env).findLast((k) => k.toLowerCase() === lower);

  return name === undefined ? undefined : env[name];
};

/** `PATH` as a child would get it; Windows names keep any case (`Path`). */
export const pathOf = (env: Env, os: string = process.platform): string =>
  valueOf(env, "PATH", os) ?? "";

/** Whether `program` names a file by its path rather than a bare name looked up on `PATH`. */
export const hasDirectory = (program: string, os: string = process.platform): boolean =>
  os === "win32" ? /[\\/:]/.test(program) : program.includes("/");

/** What Bun.spawn can start on Windows; PATHEXT's other entries (`.js`, `.vbs`) it can't. */
const SPAWNABLE = [".COM", ".EXE", ".BAT", ".CMD"];

const DEFAULT_PATHEXT = SPAWNABLE.join(";");

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

export interface SearchIo {
  readonly isFile: (path: string) => boolean;
}

/**
 * Windows' lookup without its cwd step: each `PATH` directory in order, each `PATHEXT` extension
 * Bun.spawn can start in PATHEXT's order. Bun.which ignores PATHEXT.
 */
export const windowsSearch = (
  name: string,
  path: string,
  pathExt: string | undefined,
  io: SearchIo = { isFile }
): string | null => {
  const given = SPAWNABLE.includes(win32.extname(name).toUpperCase());

  const extensions = given
    ? [""]
    : (pathExt || DEFAULT_PATHEXT)
        .split(";")
        .map((ext) => ext.trim().toUpperCase())
        .filter((ext) => SPAWNABLE.includes(ext));

  for (const entry of path.split(";")) {
    // An empty entry is no directory (Bun skips it too); cmd.exe strips an entry's quotes.
    const dir = entry.trim().replace(/^"(.*)"$/, "$1");

    if (dir === "") continue;

    for (const ext of extensions) {
      const candidate = win32.join(dir, `${name}${ext.toLowerCase()}`);

      if (io.isFile(candidate)) return candidate;
    }
  }

  return null;
};

/**
 * The absolute path of `program` for a child with `env`: an absolute path as given, a relative
 * one against the Daemon's cwd, a bare name on the child's `PATH`. Never the child's cwd; null
 * when there is none.
 */
export const findExecutable = (program: string, env: Env = process.env): string | null => {
  if (isAbsolute(program)) return program;

  // Relative paths and a `.` entry's results resolve here, never against the child's cwd.
  if (hasDirectory(program)) return resolve(program);

  // An env without one (repositoryEnv drops Windows' `Path`) looks where Bun.spawn would: the Daemon's.
  const path = pathOf(env) || pathOf(process.env);

  const found =
    process.platform === "win32"
      ? windowsSearch(program, path, valueOf(env, "PATHEXT", "win32"))
      : Bun.which(program, { PATH: path });

  return found === null ? null : resolve(found);
};

const cache = new Map<string, string>();

/**
 * `findExecutable` for a spawn: cached per program, `PATH` and `PATHEXT` (git runs on every
 * status), and a program found nowhere fails instead of falling back to its bare name.
 */
export const executableOf = (program: string, env: Env = process.env): string => {
  if (isAbsolute(program)) return program;
  const key = `${program}\0${pathOf(env) || pathOf(process.env)}\0${valueOf(env, "PATHEXT", process.platform) ?? ""}`;
  const known = cache.get(key);

  if (known !== undefined) return known;
  const found = findExecutable(program, env);

  if (found === null) throw new ExecutableNotFound({ program });

  if (!hasDirectory(program)) cache.set(key, found);

  return found;
};
