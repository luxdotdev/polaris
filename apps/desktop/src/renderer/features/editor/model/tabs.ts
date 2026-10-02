/**
 * A Workspace's open tabs (DESIGN.md, Editor: tabs). A preview tab (a single
 * click in the explorer) is replaced by the next preview; editing it or
 * opening it again pins it.
 */

export interface Tab {
  /** The file's absolute path on the Host. */
  readonly path: string;
  readonly preview: boolean;
}

export interface TabSet {
  readonly tabs: ReadonlyArray<Tab>;
  /** The active tab's path. */
  readonly active: string | null;
}

export const emptyTabs: TabSet = { tabs: [], active: null };

export const openTab = (set: TabSet, path: string, preview: boolean): TabSet => {
  const at = set.tabs.findIndex((t) => t.path === path);

  if (at !== -1) {
    const tab = set.tabs[at];
    const pinned = tab !== undefined && tab.preview && !preview;

    const tabs = pinned
      ? set.tabs.map((t, i) => (i === at ? { path, preview: false } : t))
      : set.tabs;

    return { tabs, active: path };
  }

  const tab = { path, preview };
  const previewAt = preview ? set.tabs.findIndex((t) => t.preview) : -1;

  // The new preview takes the old preview's place; anything else opens after the active tab.
  if (previewAt !== -1) {
    return { tabs: set.tabs.map((t, i) => (i === previewAt ? tab : t)), active: path };
  }

  const activeAt = set.tabs.findIndex((t) => t.path === set.active);
  const tabs = [...set.tabs];

  tabs.splice(activeAt === -1 ? tabs.length : activeAt + 1, 0, tab);

  return { tabs, active: path };
};

export const pinTab = (set: TabSet, path: string): TabSet =>
  set.tabs.some((t) => t.path === path && t.preview)
    ? { ...set, tabs: set.tabs.map((t) => (t.path === path ? { path, preview: false } : t)) }
    : set;

/** Closing the active tab activates its right neighbour, else its left. */
export const closeTab = (set: TabSet, path: string): TabSet => {
  const at = set.tabs.findIndex((t) => t.path === path);

  if (at === -1) return set;
  const tabs = set.tabs.filter((t) => t.path !== path);

  if (set.active !== path) return { tabs, active: set.active };
  const next = tabs[Math.min(at, tabs.length - 1)];

  return { tabs, active: next?.path ?? null };
};

/** ⌃⇥ / ⌃⇧⇥: the next or previous tab, wrapping. */
export const cycleTab = (set: TabSet, delta: 1 | -1): TabSet => {
  if (set.tabs.length === 0) return set;
  const at = set.tabs.findIndex((t) => t.path === set.active);
  const next = set.tabs[(at + delta + set.tabs.length) % set.tabs.length];

  return { ...set, active: next?.path ?? set.active };
};

/** `path` after `from` moved to `to`: the file itself, or anything under a moved folder. */
export const movedPath = (path: string, from: string, to: string): string =>
  path === from ? to : path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;

/** A renamed or moved file, or folder, keeps its tabs. */
export const renameTab = (set: TabSet, from: string, to: string): TabSet => ({
  tabs: set.tabs.map((t) => ({ ...t, path: movedPath(t.path, from, to) })),
  active: set.active === null ? null : movedPath(set.active, from, to),
});

/** Labels for tabs that share a file name: the shortest distinct parent suffix ("hosts/index.ts"). */
export const tabLabels = (paths: ReadonlyArray<string>): ReadonlyArray<string> => {
  const parts = paths.map((p) => p.split("/").filter((s) => s.length > 0));

  return parts.map((mine, i) => {
    let depth = 1;

    const clash = (d: number) =>
      parts.some((other, j) => j !== i && other.slice(-d).join("/") === mine.slice(-d).join("/"));

    while (depth < mine.length && clash(depth)) depth++;

    return mine.slice(-depth).join("/");
  });
};
