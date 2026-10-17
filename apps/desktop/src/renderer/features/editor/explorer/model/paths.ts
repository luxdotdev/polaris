/**
 * Paths on a Host: the explorer's paths are absolute, joined with "/", or with "\" on a
 * Windows Host (`C:\…`). Names and relative paths arrive "/"-separated, as git spells them.
 */
import {
  isWindowsPath,
  joinPath,
  lastSeparator,
  separatorOf,
} from "../../../../../shared/hostPath.ts";

export const join = (dir: string, name: string) => (dir === "/" ? `/${name}` : joinPath(dir, name));

/** A drive's root ("C:\") is its own parent, as "/" is. */
const rootOf = (path: string) => (isWindowsPath(path) ? `${path.slice(0, 2)}\\` : "/");

export const dirname = (path: string) => {
  const at = lastSeparator(path);

  return at <= rootOf(path).length - 1 ? rootOf(path) : path.slice(0, at);
};

export const basename = (path: string) => path.slice(lastSeparator(path) + 1);

const prefixOf = (dir: string) =>
  dir.endsWith(separatorOf(dir)) ? dir : `${dir}${separatorOf(dir)}`;

/** True when `path` is `dir` or inside it. */
export const isUnder = (path: string, dir: string) =>
  path === dir || path.startsWith(prefixOf(dir));

/** Where `path` is after `from` moved to `to`: itself, or under the moved folder. */
export const movedPath = (path: string, from: string, to: string) =>
  isUnder(path, from) ? `${to}${path.slice(from.length)}` : path;

/** `path` relative to `dir` ("" for `dir` itself), "/"-separated; assumes `isUnder(path, dir)`. */
export const relative = (path: string, dir: string) =>
  path === dir ? "" : path.slice(prefixOf(dir).length).replaceAll(separatorOf(dir), "/");

/** An absolute path, resolving a relative one against `cwd` and dropping `.` and `..`. */
export const resolve = (cwd: string, path: string) => {
  const windows = isWindowsPath(path) || (!path.startsWith("/") && isWindowsPath(cwd));
  const absolute = windows ? isWindowsPath(path) : path.startsWith("/");
  const full = absolute ? path : `${cwd}${windows ? "\\" : "/"}${path}`;
  // A drive ("C:") is the first part and never popped; "/" has none to keep.
  const parts = normalized(full.split(windows ? /[\\/]/ : "/"), windows ? 1 : 0);

  if (!windows) return `/${parts.join("/")}`;

  return full.startsWith("\\\\")
    ? `\\\\${parts.join("\\")}`
    : `${parts[0]}\\${parts.slice(1).join("\\")}`;
};

/** Segments with `.` and empties dropped and `..` applied, never above the first `keep`. */
const normalized = (segments: ReadonlyArray<string>, keep: number) => {
  const parts: Array<string> = [];

  for (const part of segments) {
    if (part === "" || part === ".") continue;

    if (part !== "..") parts.push(part);
    else if (parts.length > keep) parts.pop();
  }

  return parts;
};

/** Every folder between `root` (exclusive) and `path` (exclusive), outermost first. */
export const foldersBetween = (root: string, path: string): ReadonlyArray<string> => {
  const out: Array<string> = [];

  for (let dir = dirname(path); dir !== root && isUnder(dir, root); dir = dirname(dir)) {
    out.unshift(dir);
  }

  return out;
};

/** A name a user typed for a new file or folder; null when it can't be one. */
export const validName = (name: string): string | null => {
  const trimmed = name.trim();

  if (trimmed === "" || trimmed === "." || trimmed === "..") return null;

  // Nested names ("src/new.ts") are fine; empty segments and parent hops are not.
  if (trimmed.startsWith("/") || trimmed.split("/").some((p) => p === "" || p === "..")) {
    return null;
  }

  return trimmed;
};
