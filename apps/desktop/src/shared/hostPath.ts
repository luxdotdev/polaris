/**
 * Paths as a Host spells them: POSIX on macOS and Linux, `C:\Users\…` (or a UNC share) on a
 * Windows Host. Told apart by the path itself, since the renderer may show both at once. Pure.
 */

const DRIVE = /^[A-Za-z]:(?:[\\/]|$)/;

/** A Windows path: a drive (`C:\`, `C:/`) or a UNC share (`\\server\share`). */
export const isWindowsPath = (path: string): boolean => DRIVE.test(path) || path.startsWith("\\\\");

/** The separator a path's Host joins with. */
export const separatorOf = (path: string): "/" | "\\" => (isWindowsPath(path) ? "\\" : "/");

/** Its non-empty segments; on Windows either slash separates, on POSIX only "/". */
export const pathSegments = (path: string): ReadonlyArray<string> =>
  path.split(isWindowsPath(path) ? /[\\/]/ : "/").filter((s) => s.length > 0);

/** The index of the last separator, or -1. */
export const lastSeparator = (path: string): number =>
  isWindowsPath(path)
    ? Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"))
    : path.lastIndexOf("/");

/** The last segment ("C:\code\polaris\" → "polaris", "/" → "/"). */
export const pathBaseName = (path: string): string => pathSegments(path).at(-1) ?? path;

/** A drive's root keeps its separator ("C:\"); other trailing separators go. */
export const trimSeparators = (path: string): string => {
  if (!isWindowsPath(path)) return path.length > 1 ? path.replace(/\/+$/, "") : path;
  const trimmed = path.replace(/[\\/]+$/, "");

  return /^[A-Za-z]:$/.test(trimmed) ? `${trimmed}\\` : trimmed;
};

/**
 * `rest` (relative, "/"-separated as git and users type it) under `dir`, in the Host's own
 * spelling: `C:\code` + `src/a.ts` → `C:\code\src\a.ts`.
 */
export const joinPath = (dir: string, rest: string): string => {
  const sep = separatorOf(dir);
  const base = trimSeparators(dir);
  const tail = sep === "\\" ? rest.replaceAll("/", "\\") : rest;

  return base.endsWith(sep) ? `${base}${tail}` : `${base}${sep}${tail}`;
};

/** Windows paths compare without case, as NTFS does by default. */
const comparable = (path: string) => (isWindowsPath(path) ? path.toLowerCase() : path);

/** What follows `dir` in `path` (no leading separator), "" for `dir` itself; null outside it. */
export const pathWithin = (path: string, dir: string): string | null => {
  const base = trimSeparators(dir);

  if (comparable(path) === comparable(base)) return "";
  const sep = separatorOf(base);
  const prefix = base.endsWith(sep) ? base : `${base}${sep}`;
  const spelled = sep === "\\" ? path.replaceAll("/", "\\") : path;

  return comparable(spelled).startsWith(comparable(prefix)) ? spelled.slice(prefix.length) : null;
};

/** An absolute path as the user reads it: under the Host's home it starts with `~`. */
export const tildePath = (path: string, home: string | null): string => {
  if (home === null || home === "" || home === "/") return path;
  const rest = pathWithin(path, home);

  if (rest === null) return path;

  return rest === "" ? "~" : `~${separatorOf(home)}${rest}`;
};
