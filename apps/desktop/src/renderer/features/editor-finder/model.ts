/**
 * ⌘P's pure parts: a query with an optional `:line`, the rows it shows (name, then the
 * folder it sits in), and the recently opened files per Workspace it starts from.
 */
import { parseLocation } from "../../routes/editor.ts";

export interface FinderQuery {
  /** What `files.searchPaths` is asked for. */
  readonly text: string;
  readonly line: number | null;
  readonly column: number | null;
}

export const parseQuery = (raw: string): FinderQuery => {
  const { path, line, column } = parseLocation(raw);

  return { text: path.trim(), line, column };
};

export interface FinderRow {
  /** Relative to the root searched. */
  readonly path: string;
  readonly name: string;
  /** The folder, "" at the root. */
  readonly folder: string;
}

export const rowOf = (path: string): FinderRow => {
  const clean = path.replace(/^\.\//, "");
  const cut = clean.lastIndexOf("/");

  return {
    path: clean,
    name: cut === -1 ? clean : clean.slice(cut + 1),
    folder: cut === -1 ? "" : clean.slice(0, cut),
  };
};

/** `path` relative to `root` when inside it; otherwise as is. */
export const relativeTo = (root: string, path: string): string => {
  const base = root.endsWith("/") ? root : `${root}/`;

  return path.startsWith(base) ? path.slice(base.length) : path;
};

export const RECENT_LIMIT = 20;

/** Most recent first, without repeats, at most `RECENT_LIMIT`. */
export const withRecent = (recent: ReadonlyArray<string>, path: string): Array<string> =>
  [path, ...recent.filter((p) => p !== path)].slice(0, RECENT_LIMIT);

/** Recent files for an empty query, or those whose path contains every word of it. */
export const matchingRecent = (
  recent: ReadonlyArray<string>,
  text: string
): ReadonlyArray<string> => {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);

  return recent.filter((p) => words.every((w) => p.toLowerCase().includes(w)));
};

export const RESULT_LIMIT = 50;
