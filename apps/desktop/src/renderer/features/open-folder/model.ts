/**
 * The ⌘O dialog's decisions (DESIGN.md, Open folder): what a typed path
 * browses, which folders the list shows, and the recent folders per Host.
 * Pure, so it is unit-tested.
 */
import type { Workspace } from "@polaris/protocol";
import type { FileEntry } from "@polaris/protocol";
import type { HostView, Plain } from "../../../shared/api.ts";
import {
  isWindowsPath,
  joinPath,
  lastSeparator,
  tildePath,
  trimSeparators,
} from "../../../shared/hostPath.ts";

/** The typed path, split: the folder it browses and the name being typed in it. */
export interface Browse {
  /** The folder listed, as typed: "~/code", "/srv", "~". */
  readonly dir: string;
  /** The same folder as the Daemon wants it; null while the Host's home is unknown. */
  readonly absolute: string | null;
  /** What follows the last separator: filters the folders listed. */
  readonly filter: string;
}

/** Where the field starts: the Host's home. */
export const START = "~/";

const trimSlash = (path: string) => (path.length > 1 ? trimSeparators(path) : path);

/** A Windows Host: its home is `C:\Users\…`, so "\" separates what the user types too. */
const windowsHome = (homeDir: string | null) => homeDir !== null && isWindowsPath(homeDir);

/** Typed as absolute: "/…", or on a Windows Host a drive or share (`C:\`, `\\nas\x`). */
const typedAbsolute = (path: string) => path.startsWith("/") || isWindowsPath(path);

/** `~/x` → `<home>/x`; a path that isn't under `~` or a root is taken from the home. */
export const expand = (path: string, homeDir: string | null): string | null => {
  if (typedAbsolute(path)) return trimSlash(path);

  if (homeDir === null) return null;

  if (path === "~" || path === "") return homeDir;

  const rest = /^~[\\/]/.test(path) ? path.slice(2) : path;

  return trimSlash(joinPath(homeDir, rest));
};

/** An absolute path as the user reads it: under the home it starts with `~`. */
export const tilde = (path: string, homeDir: string | null): string => tildePath(path, homeDir);

const lastTyped = (text: string, homeDir: string | null) =>
  windowsHome(homeDir)
    ? Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"))
    : text.lastIndexOf("/");

/** The folder before the cut; a bare drive ("C:") is its root ("C:\"). */
const dirOf = (text: string, cut: number) => {
  if (cut === -1) return "~";

  if (cut === 0) return "/";
  const head = text.slice(0, cut);

  return /^[A-Za-z]:$/.test(head) ? `${head}\\` : head;
};

export const browseOf = (typed: string, homeDir: string | null): Browse => {
  const text = typed.trim() === "" ? START : typed.trim();
  const cut = lastTyped(text, homeDir);
  const dir = dirOf(text, cut);
  const filter = cut === -1 ? text : text.slice(cut + 1);

  return { dir, absolute: expand(dir, homeDir), filter };
};

/** The field's text once the user steps into a folder: its path, with a trailing separator. */
export const enter = (path: string, homeDir: string | null): string => {
  const shown = tilde(path, homeDir);
  const sep = windowsHome(homeDir) || isWindowsPath(path) ? "\\" : "/";

  return shown.endsWith(sep) ? shown : `${shown}${sep}`;
};

/** A root has no parent: "/", "C:\". */
const isRoot = (path: string) => path === "/" || /^[A-Za-z]:\\?$/.test(path);

/** The field's text one folder up: "~/code/polaris/" → "~/code/". */
export const up = (typed: string, homeDir: string | null): string => {
  const { dir, absolute } = browseOf(typed, homeDir);

  if (absolute === null || isRoot(absolute)) return typed;

  const parent = trimSlash(absolute.slice(0, lastSeparator(absolute) + 1)) || "/";

  return dir.startsWith("~") || dir === "" ? enter(parent, homeDir) : enter(parent, null);
};

export interface FolderRow {
  readonly name: string;
  readonly path: string;
  /** The Workspace already registered here, if any: opening it selects it. */
  readonly workspace: string | null;
}

type Entry = Pick<Plain<FileEntry>, "name" | "path" | "kind">;

/** A name matching the filter: prefix matches first (".config" starts with "con" too), then anywhere. */
const rank = (name: string, filter: string) => {
  if (filter === "") return 0;

  const lower = name.toLowerCase();
  const wanted = filter.toLowerCase();

  if (lower.startsWith(wanted) || lower.replace(/^\./, "").startsWith(wanted)) return 0;

  return lower.includes(wanted) ? 1 : -1;
};

/**
 * The folders to list: directories and links (a link may be one), filtered and ranked;
 * every one is shown, dot-folders after the others at the same rank.
 */
export const folderRows = (
  entries: ReadonlyArray<Entry>,
  filter: string,
  workspaces: ReadonlyArray<Pick<Workspace, "path" | "name">>
): ReadonlyArray<FolderRow> => {
  const byPath = new Map(workspaces.map((w) => [w.path, w.name]));
  const dot = (e: Entry) => Number(e.name.startsWith("."));

  const ranked = entries.flatMap((entry) => {
    const at = rank(entry.name, filter);
    const folder = entry.kind === "directory" || entry.kind === "symlink";

    return folder && at >= 0 ? [{ entry, at }] : [];
  });

  return ranked
    .sort(
      (a, b) =>
        a.at - b.at || dot(a.entry) - dot(b.entry) || a.entry.name.localeCompare(b.entry.name)
    )
    .map(({ entry }) => ({
      name: entry.name,
      path: entry.path,
      workspace: byPath.get(entry.path) ?? null,
    }));
};

export const RECENT_FOLDERS = 5;

export type RecentFolders = Readonly<Record<string, ReadonlyArray<string>>>;

/** `path` first in the Host's recent folders, without duplicates, capped. */
export const withRecentFolder = (recent: RecentFolders, hostKey: string, path: string) => ({
  ...recent,
  [hostKey]: [path, ...(recent[hostKey] ?? []).filter((p) => p !== path)].slice(0, RECENT_FOLDERS),
});

/** Whether the Host can be browsed now; otherwise the dialog says why, in its state's words. */
export const browsable = (host: HostView) =>
  host.status.state === "connected" && host.status.host !== null;

/** A folder that can't be listed, in words: the Daemon's message carries the errno code. */
export const listError = (message: string, dir: string): string => {
  if (message.includes("ENOENT")) return `No folder at ${dir}`;

  if (message.includes("ENOTDIR")) return `${dir} isn't a folder`;

  if (message.includes("EACCES") || message.includes("EPERM")) return `Can't read ${dir}`;

  return `Couldn't list ${dir}`;
};
