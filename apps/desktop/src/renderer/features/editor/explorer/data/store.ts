/**
 * The explorer's state per Workspace: listings, open folders, Files or Changes,
 * git marks, and the row being created or renamed. Open folders and the view
 * persist per Workspace in localStorage; listings and git refetch on launch.
 */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { GitMarks } from "../model/git.ts";
import type { Listing } from "../model/tree.ts";

export type ExplorerView = "files" | "changes";

export interface GitFacts {
  /** The repository's top level: where git's paths start. */
  readonly toplevel: string;
  /** HEAD's commit; null before the first commit. The gutter's base. */
  readonly head: string | null;
  readonly branch: string | null;
  readonly ahead: number;
  readonly marks: GitMarks;
}

/** A row being typed into: a new file or folder in `dir`, or a rename of `path`. */
export type Draft =
  | { readonly kind: "create"; readonly dir: string; readonly entry: "file" | "directory" }
  | { readonly kind: "rename"; readonly path: string };

export interface WorkspaceExplorer {
  readonly view: ExplorerView;
  readonly expanded: ReadonlySet<string>;
  readonly listings: ReadonlyMap<string, Listing>;
  /** Null until known; "none" outside a git repository. */
  readonly git: GitFacts | "none" | null;
  readonly draft: Draft | null;
  /** The row with keyboard focus (a path), for ↑/↓ and the context actions. */
  readonly focused: string | null;
  /** A Worktree or Review Checkout the explorer shows instead of the Workspace's folder. */
  readonly root: string | null;
  /** A path asked to be shown (revealInExplorer), until the explorer has opened its way to it. */
  readonly reveal: string | null;
}

export const emptyExplorer: WorkspaceExplorer = {
  view: "files",
  expanded: new Set(),
  listings: new Map(),
  git: null,
  draft: null,
  focused: null,
  root: null,
  reveal: null,
};

export const explorerKey = (hostKey: string, workspaceId: string) =>
  `${hostKey}\u0000${workspaceId}`;

const STORAGE_KEY = "polaris.explorer.v1";

/** Workspaces whose open folders are remembered, most recent last. */
const KEPT = 40;

interface Saved {
  readonly view: ExplorerView;
  readonly expanded: ReadonlyArray<string>;
}

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const readSaved = (): Record<string, Saved> => {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);

    // SAFETY: only this module writes the key, always as a record of Saved.
    return raw === null || raw === undefined ? {} : (JSON.parse(raw) as Record<string, Saved>);
  } catch {
    return {};
  }
};

const save = (key: string, value: WorkspaceExplorer) => {
  const saved = readSaved();

  delete saved[key];
  saved[key] = { view: value.view, expanded: [...value.expanded] };
  const kept = Object.entries(saved).slice(-KEPT);

  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Storage full or unavailable: the tree just opens closed next time.
  }
};

const explorers = createStore<Readonly<Record<string, WorkspaceExplorer>>>(() => ({}));

/** What a Workspace starts from, read once, so a render's snapshot is stable. */
const initial = new Map<string, WorkspaceExplorer>();

export const explorerOf = (key: string): WorkspaceExplorer => {
  const current = explorers.getState()[key] ?? initial.get(key);

  if (current !== undefined) return current;
  const saved = readSaved()[key];

  const first =
    saved === undefined
      ? emptyExplorer
      : { ...emptyExplorer, view: saved.view, expanded: new Set(saved.expanded) };

  initial.set(key, first);

  return first;
};

export const patchExplorer = (
  key: string,
  change: (current: WorkspaceExplorer) => Partial<WorkspaceExplorer>
) => {
  const current = explorerOf(key);
  const patch = change(current);
  const next = { ...current, ...patch };

  explorers.setState({ ...explorers.getState(), [key]: next });

  if (patch.view !== undefined || patch.expanded !== undefined) save(key, next);
};

export const setListing = (key: string, dir: string, listing: Listing) =>
  patchExplorer(key, (s) => ({ listings: new Map(s.listings).set(dir, listing) }));

export const toggleFolder = (key: string, dir: string, open?: boolean) =>
  patchExplorer(key, (s) => {
    const expanded = new Set(s.expanded);

    if (open ?? !expanded.has(dir)) expanded.add(dir);
    else expanded.delete(dir);

    return { expanded };
  });

/** Calls `listener` on every change to any Workspace's explorer (the gutter follows HEAD). */
export const subscribeExplorers = (listener: () => void) => explorers.subscribe(listener);

export const useExplorerState = (key: string): WorkspaceExplorer =>
  useStore(explorers, (all) => all[key] ?? explorerOf(key));

/** Tests only: forget every Workspace's state. */
export const resetExplorers = () => {
  initial.clear();
  explorers.setState({});
};
