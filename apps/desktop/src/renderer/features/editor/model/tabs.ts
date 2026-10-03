/**
 * A Workspace's open tabs (DESIGN.md, Editor: tabs). A preview tab (a single
 * click in the explorer) is replaced by the next preview; editing it or
 * opening it again pins it.
 */

export interface Tab {
  /** The file's absolute path on the Host. */
  readonly path: string;
  readonly preview: boolean;
  /** Rendered Markdown; omitted for source tabs and legacy persistence. */
  readonly view?: "markdown";
  readonly locked?: boolean;
}

export interface TabSet {
  readonly tabs: ReadonlyArray<Tab>;
  /** The active tab's path. */
  readonly active: string | null;
  readonly activeView?: "markdown";
}

export const emptyTabs: TabSet = { tabs: [], active: null };

/** Stable view identity; buffer identity remains the Host/path pair. */
export const tabId = (tab: Tab): string =>
  tab.view === "markdown" ? "markdown-preview" : tab.path;

export const activeTabId = (set: TabSet): string | null =>
  set.activeView === "markdown" ? "markdown-preview" : set.active;

const select = (tabs: ReadonlyArray<Tab>, tab: Tab | undefined): TabSet =>
  tab?.view === "markdown"
    ? { tabs, active: tab.path, activeView: "markdown" }
    : { tabs, active: tab?.path ?? null };

/** Retarget the rendered view, retaining a source tab when its last view holds unsaved edits. */
export const followMarkdown = (set: TabSet, path: string, keepPreviousSource = false): TabSet => {
  const rendered = set.tabs.find((t) => t.view === "markdown");

  if (rendered === undefined || rendered.locked || rendered.path === path) return set;
  const tabs = set.tabs.map((t) => (t === rendered ? { ...t, path } : t));

  if (keepPreviousSource && !tabs.some((t) => t.path === rendered.path))
    tabs.push({ path: rendered.path, preview: false });

  return { ...set, tabs, active: set.activeView === "markdown" ? path : set.active };
};

export const openMarkdown = (set: TabSet, path: string): TabSet => {
  const rendered = set.tabs.find((t) => t.view === "markdown");

  if (rendered !== undefined) return select(set.tabs, rendered);
  const tab: Tab = { path, preview: false, view: "markdown", locked: false };
  const tabs = [...set.tabs];
  const at = set.tabs.findIndex((t) => tabId(t) === activeTabId(set));
  tabs.splice(at === -1 ? tabs.length : at + 1, 0, tab);

  return select(tabs, tab);
};

export const lockMarkdown = (set: TabSet, locked: boolean): TabSet => ({
  ...set,
  tabs: set.tabs.map((t) => (t.view === "markdown" ? { ...t, locked } : t)),
});

export const activateTab = (set: TabSet, id: string): TabSet => {
  const tab = set.tabs.find((t) => tabId(t) === id);

  return tab === undefined ? set : select(set.tabs, tab);
};

export const openTab = (set: TabSet, path: string, preview: boolean): TabSet => {
  const at = set.tabs.findIndex((t) => t.path === path && t.view !== "markdown");

  if (at !== -1) {
    const tabs = set.tabs.map((t, i) =>
      i === at && t.preview && !preview ? { path, preview: false } : t
    );

    return select(tabs, tabs[at]);
  }

  const tab: Tab = { path, preview };
  const previewAt = preview ? set.tabs.findIndex((t) => t.preview && t.view !== "markdown") : -1;

  if (previewAt !== -1)
    return select(
      set.tabs.map((t, i) => (i === previewAt ? tab : t)),
      tab
    );
  const tabs = [...set.tabs];
  const atActive = set.tabs.findIndex((t) => tabId(t) === activeTabId(set));
  tabs.splice(atActive === -1 ? tabs.length : atActive + 1, 0, tab);

  return select(tabs, tab);
};

export const pinTab = (set: TabSet, path: string): TabSet =>
  set.tabs.some((t) => t.path === path && t.view !== "markdown" && t.preview)
    ? {
        ...set,
        tabs: set.tabs.map((t) =>
          t.path === path && t.view !== "markdown" ? { path, preview: false } : t
        ),
      }
    : set;

/** Closing the active view activates its right neighbour, else its left. */
export const closeTab = (set: TabSet, id: string): TabSet => {
  const at = set.tabs.findIndex((t) => tabId(t) === id);

  if (at === -1) return set;
  const tabs = set.tabs.filter((t) => tabId(t) !== id);

  return activeTabId(set) === id
    ? select(tabs, tabs[Math.min(at, tabs.length - 1)])
    : { ...set, tabs };
};

/** ⌃⇥ / ⌃⇧⇥: the next or previous view, wrapping. */
export const cycleTab = (set: TabSet, delta: 1 | -1): TabSet => {
  if (set.tabs.length === 0) return set;
  const at = set.tabs.findIndex((t) => tabId(t) === activeTabId(set));

  return select(set.tabs, set.tabs[(at + delta + set.tabs.length) % set.tabs.length]);
};

/** `path` after `from` moved to `to`: the file itself, or anything under a moved folder. */
export const movedPath = (path: string, from: string, to: string): string =>
  path === from ? to : path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;

/** A renamed or moved file, or folder, keeps its tabs. */
export const renameTab = (set: TabSet, from: string, to: string): TabSet => ({
  ...set,
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
