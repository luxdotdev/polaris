/** POSIX paths on a Host: the explorer's paths are absolute, joined with "/". */

export const join = (dir: string, name: string) =>
  dir === "/" ? `/${name}` : `${dir.replace(/\/+$/, "")}/${name}`;

export const dirname = (path: string) => {
  const at = path.lastIndexOf("/");

  return at <= 0 ? "/" : path.slice(0, at);
};

export const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** True when `path` is `dir` or inside it. */
export const isUnder = (path: string, dir: string) =>
  path === dir || path.startsWith(dir === "/" ? "/" : `${dir}/`);

/** `path` relative to `dir` ("" for `dir` itself); assumes `isUnder(path, dir)`. */
export const relative = (path: string, dir: string) =>
  path === dir ? "" : path.slice(dir === "/" ? 1 : dir.length + 1);

/** An absolute path, resolving a relative one against `cwd` and dropping `.` and `..`. */
export const resolve = (cwd: string, path: string) => {
  const parts: Array<string> = [];

  for (const part of (path.startsWith("/") ? path : `${cwd}/${path}`).split("/")) {
    if (part === "" || part === ".") continue;

    if (part === "..") parts.pop();
    else parts.push(part);
  }

  return `/${parts.join("/")}`;
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
