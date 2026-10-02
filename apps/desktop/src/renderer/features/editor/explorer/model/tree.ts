/**
 * The Files tree as rows (DESIGN.md, Editor → Explorer): folders first, then
 * files; open folders list their children; a chain of single folders reads as
 * one row ("src/orchestrator"); deleted files stay, struck through. Pure.
 */
import type { GitStatus } from "@polaris/ui";
import type { AgentMarks } from "./agents.ts";
import { deletedIn, type GitMarks, statusAt } from "./git.ts";
import { basename, dirname, isUnder } from "./paths.ts";

export interface Entry {
  readonly name: string;
  readonly path: string;
  readonly kind: "file" | "directory" | "symlink" | "other";
}

export type Listing =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly entries: ReadonlyArray<Entry> }
  | { readonly kind: "error"; readonly message: string };

export interface TreeInput {
  readonly root: string;
  readonly listings: ReadonlyMap<string, Listing>;
  /** Open folders by their own path (a compacted row by its first folder). */
  readonly expanded: ReadonlySet<string>;
  readonly marks: GitMarks;
  readonly agents: AgentMarks;
}

export interface TreeRow {
  /** The file, or the last folder of a compacted chain: what actions act on. */
  readonly path: string;
  /** What toggling opens or closes: the first folder of the chain. */
  readonly toggle: string;
  readonly label: string;
  readonly kind: "file" | "folder";
  readonly depth: number;
  readonly open: boolean;
  readonly git: GitStatus | null;
  /** A folder holding changes: the 5px dot. */
  readonly dirty: boolean;
  /** The Harness changing this file now: the 12px dither. */
  readonly agent: string | null;
  /** An agent is blocked on something in here: the needs-you hand. */
  readonly hand: boolean;
  readonly deleted: boolean;
  /** Set on an open folder while its listing loads or failed. */
  readonly listing: "loading" | "error" | null;
}

const HIDDEN = new Set([".git", ".DS_Store"]);

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const isFolder = (entry: Entry) => entry.kind === "directory";

/** Folders first, then by name as people sort them ("file2" before "file10"). */
export const byTreeOrder = (a: Entry, b: Entry) =>
  Number(isFolder(b)) - Number(isFolder(a)) || collator.compare(a.name, b.name);

/** A folder's children as listed, plus its deleted files, sorted; null until listed. */
export const childrenOf = (input: TreeInput, dir: string): ReadonlyArray<Entry> | null => {
  const listing = input.listings.get(dir);

  if (listing?.kind !== "ready") return null;
  const listed = listing.entries.filter((e) => !HIDDEN.has(e.name));
  const names = new Set(listed.map((e) => e.path));

  const gone = deletedIn(input.marks, dir)
    .filter((path) => !names.has(path))
    .map((path): Entry => ({ name: basename(path), path, kind: "file" }));

  return [...listed, ...gone].sort(byTreeOrder);
};

/** The chain a folder compacts into: itself, then each lone child folder, as far as listed. */
export const chainOf = (input: TreeInput, dir: string): ReadonlyArray<string> => {
  const chain = [dir];

  for (;;) {
    const children = childrenOf(input, chain.at(-1)!);
    const only = children?.length === 1 ? children[0] : undefined;

    if (only === undefined || !isFolder(only)) return chain;
    chain.push(only.path);
  }
};

const blockedUnder = (agents: AgentMarks, dir: string, open: boolean) =>
  [...agents.blocked].some((path) => (open ? dirname(path) === dir : isUnder(path, dir)));

interface Walk {
  readonly input: TreeInput;
  readonly rows: Array<TreeRow>;
}

const folderRow = (walk: Walk, entry: Entry, depth: number) => {
  const { input } = walk;
  const chain = chainOf(input, entry.path);
  const tail = chain.at(-1)!;
  const open = input.expanded.has(entry.path);
  const listing = input.listings.get(tail)?.kind;

  walk.rows.push({
    path: tail,
    toggle: entry.path,
    label: chain.map(basename).join("/"),
    kind: "folder",
    depth,
    open,
    git: statusAt(input.marks, tail, input.root),
    dirty: input.marks.dirtyFolders.has(tail),
    agent: null,
    hand: blockedUnder(input.agents, tail, open),
    deleted: false,
    listing:
      open && listing === "loading" ? "loading" : open && listing === "error" ? "error" : null,
  });

  if (open) addChildren(walk, tail, depth + 1);
};

const fileRow = (walk: Walk, entry: Entry, depth: number) => {
  const { input } = walk;
  const git = statusAt(input.marks, entry.path, input.root);
  const atRoot = dirname(entry.path) === input.root;

  walk.rows.push({
    path: entry.path,
    toggle: entry.path,
    label: entry.name,
    kind: "file",
    depth,
    open: false,
    git,
    dirty: false,
    agent: input.agents.editing.get(entry.path) ?? null,
    // Nothing folds a top-level file away, so its own row carries the hand.
    hand: atRoot && input.agents.blocked.has(entry.path),
    deleted: git === "deleted",
    listing: null,
  });
};

function addChildren(walk: Walk, dir: string, depth: number) {
  for (const entry of childrenOf(walk.input, dir) ?? []) {
    if (isFolder(entry)) folderRow(walk, entry, depth);
    else fileRow(walk, entry, depth);
  }
}

/** The visible rows, top to bottom. */
export const treeRows = (input: TreeInput): ReadonlyArray<TreeRow> => {
  const walk: Walk = { input, rows: [] };

  addChildren(walk, input.root, 0);

  return walk.rows;
};

/** Folders whose listing the tree needs now: the root and each open chain's last folder. */
export const foldersToList = (input: TreeInput): ReadonlyArray<string> => {
  const wanted = [input.root];

  const visit = (dir: string) => {
    for (const entry of childrenOf(input, dir) ?? []) {
      if (!isFolder(entry)) continue;
      const chain = chainOf(input, entry.path);
      const tail = chain.at(-1)!;

      // Closed folders aren't listed ahead (one call each, remote Hosts too); an open
      // chain's tail decides whether it grows, and is what the row shows.
      if (!input.expanded.has(entry.path)) continue;

      if (input.listings.has(tail)) visit(tail);
      else wanted.push(tail);
    }
  };

  visit(input.root);

  return wanted;
};

/** Opens every folder between the root and `path`, so a revealed file is in view. */
export const expandTo = (
  expanded: ReadonlySet<string>,
  root: string,
  path: string
): ReadonlySet<string> => {
  const next = new Set(expanded);

  for (let dir = dirname(path); isUnder(dir, root) && dir !== root; dir = dirname(dir)) {
    next.add(dir);
  }

  return next;
};
