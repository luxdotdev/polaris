/**
 * The `@` picker's rules, without an editor: the rows for a query (folders
 * that match, then the files the Host's index found), and the text a Turn
 * sends for a mention, which every Harness reads as a file reference.
 */

export interface MentionRow {
  /** Relative to the session's directory; a folder's ends with `/`. */
  readonly path: string;
  readonly kind: "file" | "folder";
  readonly name: string;
  /** The folder it sits in, "" at the root. */
  readonly parent: string;
}

/** A search's answer: relative file paths, best first, or why there are none. */
export interface MentionAnswer {
  readonly paths: ReadonlyArray<string>;
  readonly failed: string | null;
}

/** Files matching a query: the Host's file index (`files.searchPaths`). */
export type MentionSearch = (query: string) => Promise<MentionAnswer>;

/** How many files the picker asks for; the list is virtualized, so this is generous. */
export const MENTION_LIMIT = 200;

/** Folders lead the list; past this many, typing narrows them. */
const FOLDER_LIMIT = 8;

const rowOf = (path: string, kind: MentionRow["kind"]): MentionRow => {
  const bare = path.endsWith("/") ? path.slice(0, -1) : path;
  const cut = bare.lastIndexOf("/");

  return {
    path,
    kind,
    name: cut === -1 ? bare : bare.slice(cut + 1),
    parent: cut === -1 ? "" : bare.slice(0, cut),
  };
};

/** Each folder the files sit in, outermost first, as `a/`, `a/b/`. */
const foldersOf = (path: string): Array<string> => {
  const parts = path.split("/").slice(0, -1);

  return parts.map((_, i) => `${parts.slice(0, i + 1).join("/")}/`);
};

/** Whether a folder matches: its name holds the query, or its path does once the query has a `/`. */
const folderMatches = (folder: string, query: string) => {
  const q = query.toLowerCase().replace(/\/$/, "");

  if (q === "") return folder.indexOf("/") === folder.length - 1;
  const lower = folder.toLowerCase();

  return query.includes("/") ? lower.includes(q) : rowOf(lower, "folder").name.includes(q);
};

/** The picker's rows for a query: matching folders (from the files found), then the files. */
export const mentionRows = (query: string, paths: ReadonlyArray<string>): Array<MentionRow> => {
  const clean = paths.map((p) => p.replace(/^\.\//, ""));
  const folders = new Set<string>();

  for (const path of clean)
    for (const folder of foldersOf(path)) if (folderMatches(folder, query)) folders.add(folder);

  const shown = [...folders]
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))
    .slice(0, FOLDER_LIMIT);

  return [
    ...shown.map((f) => rowOf(f, "folder" as const)),
    ...clean.map((p) => rowOf(p, "file" as const)),
  ];
};

/** The text a Turn carries for a mention: `@path`, quoted when the path has spaces. */
export const mentionText = (path: string): string => (/\s/.test(path) ? `@"${path}"` : `@${path}`);
