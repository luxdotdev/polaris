/**
 * The ⌘O dialog's decisions (DESIGN.md, Open folder): what a typed path
 * browses, which folders the list shows, and the recent folders per Host.
 * Pure, so it is unit-tested.
 */
import type { Workspace } from "@polaris/protocol";
import type { FileEntry } from "@polaris/protocol";
import type { HostView, Plain } from "../../../shared/api.ts";

/** The typed path, split: the folder it browses and the name being typed in it. */
export interface Browse {
  /** The folder listed, as typed: "~/code", "/srv", "~". */
  readonly dir: string;
  /** The same folder as the Daemon wants it; null while the Host's home is unknown. */
  readonly absolute: string | null;
  /** What follows the last "/": filters the folders listed. */
  readonly filter: string;
}

/** Where the field starts: the Host's home. */
export const START = "~/";

const trimSlash = (path: string) => (path.length > 1 ? path.replace(/\/+$/, "") : path);

/** `~/x` → `<home>/x`; a path that isn't under `~` or `/` is taken from the home. */
export const expand = (path: string, homeDir: string | null): string | null => {
  if (path.startsWith("/")) return trimSlash(path);

  if (homeDir === null) return null;

  if (path === "~" || path === "") return homeDir;

  const rest = path.startsWith("~/") ? path.slice(2) : path;

  return trimSlash(`${trimSlash(homeDir)}/${rest}`);
};

/** An absolute path as the user reads it: under the home it starts with `~`. */
export const tilde = (path: string, homeDir: string | null): string => {
  if (homeDir === null || homeDir === "/") return path;

  const home = trimSlash(homeDir);

  if (path === home) return "~";

  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
};

export const browseOf = (typed: string, homeDir: string | null): Browse => {
  const text = typed.trim() === "" ? START : typed.trim();
  const cut = text.lastIndexOf("/");
  const dir = cut === -1 ? "~" : cut === 0 ? "/" : text.slice(0, cut);
  const filter = cut === -1 ? text : text.slice(cut + 1);

  return { dir, absolute: expand(dir, homeDir), filter };
};

/** The field's text once the user steps into a folder: its path, with a trailing "/". */
export const enter = (path: string, homeDir: string | null): string => {
  const shown = tilde(path, homeDir);

  return shown.endsWith("/") ? shown : `${shown}/`;
};

/** The field's text one folder up: "~/code/polaris/" → "~/code/". */
export const up = (typed: string, homeDir: string | null): string => {
  const { dir, absolute } = browseOf(typed, homeDir);

  if (absolute === null || absolute === "/") return typed;

  const parent = absolute.slice(0, absolute.lastIndexOf("/")) || "/";

  return dir.startsWith("~") || dir === "" ? enter(parent, homeDir) : enter(parent, null);
};

export interface FolderRow {
  readonly name: string;
  readonly path: string;
  /** The Workspace already registered here, if any: opening it selects it. */
  readonly workspace: string | null;
}

type Entry = Pick<Plain<FileEntry>, "name" | "path" | "kind">;

/** A name matching the filter: prefix matches first, then anywhere in the name. */
const rank = (name: string, filter: string) => {
  if (filter === "") return 0;

  const lower = name.toLowerCase();
  const wanted = filter.toLowerCase();

  if (lower.startsWith(wanted)) return 0;

  return lower.includes(wanted) ? 1 : -1;
};

/**
 * The folders to list: directories and links (a link may be one), filtered and ranked;
 * dot-folders only when the filter starts with ".".
 */
export const folderRows = (
  entries: ReadonlyArray<Entry>,
  filter: string,
  workspaces: ReadonlyArray<Pick<Workspace, "path" | "name">>
): ReadonlyArray<FolderRow> => {
  const byPath = new Map(workspaces.map((w) => [w.path, w.name]));
  const shown = (e: Entry) => !e.name.startsWith(".") || filter.startsWith(".");

  const ranked = entries.flatMap((entry) => {
    const at = rank(entry.name, filter);
    const folder = entry.kind === "directory" || entry.kind === "symlink";

    return folder && shown(entry) && at >= 0 ? [{ entry, at }] : [];
  });

  return ranked
    .sort((a, b) => a.at - b.at || a.entry.name.localeCompare(b.entry.name))
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
