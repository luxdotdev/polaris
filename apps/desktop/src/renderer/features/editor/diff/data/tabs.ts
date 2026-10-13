/**
 * Diff tabs (DESIGN.md, Editor: diff tabs): read-only tabs after a Workspace's file tabs, one
 * per file and side of the index. Like a file, a single click opens a preview tab that the
 * next click replaces; a double click keeps it. They're never persisted: git moves on.
 */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { workspaceKey } from "../../model/drafts.ts";
import { editorStore } from "../../runtime/store.ts";
import { activateLogTab, logTabStore } from "../../status/logTabs.ts";
import { type DiffTarget, diffTabId } from "../model/target.ts";

export interface DiffTab {
  readonly id: string;
  readonly target: DiffTarget;
  readonly preview: boolean;
}

export interface WorkspaceDiffs {
  readonly tabs: readonly DiffTab[];
  readonly active: string | null;
}

const NONE: WorkspaceDiffs = { tabs: [], active: null };

export const diffTabStore = createStore<{
  readonly workspaces: Readonly<Record<string, WorkspaceDiffs>>;
}>(() => ({ workspaces: {} }));

const update = (key: string, change: (diffs: WorkspaceDiffs) => WorkspaceDiffs) =>
  diffTabStore.setState((state) => {
    const before = state.workspaces[key] ?? NONE;
    const after = change(before);

    return after === before ? state : { workspaces: { ...state.workspaces, [key]: after } };
  });

/** The tabs after opening `tab`: shown again, kept, or put in the preview's place. */
export const withOpened = (diffs: WorkspaceDiffs, tab: DiffTab): WorkspaceDiffs => {
  const open = diffs.tabs.find((t) => t.id === tab.id);

  if (open !== undefined)
    return {
      tabs: diffs.tabs.map((t) =>
        t.id === tab.id ? { ...tab, preview: t.preview && tab.preview } : t
      ),
      active: tab.id,
    };

  const preview = tab.preview ? diffs.tabs.findIndex((t) => t.preview) : -1;

  return {
    tabs:
      preview === -1 ? [...diffs.tabs, tab] : diffs.tabs.map((t, i) => (i === preview ? tab : t)),
    active: tab.id,
  };
};

/** Opens (or shows) the diff of `target`; `pin` keeps it rather than previewing. */
export const openDiff = (target: DiffTarget, pin = false) => {
  update(workspaceKey(target.hostKey, target.workspaceId), (diffs) =>
    withOpened(diffs, { id: diffTabId(target), target, preview: !pin })
  );
  activateLogTab(target.hostKey, target.workspaceId, null);
};

export const activateDiffTab = (hostKey: string, workspaceId: string, id: string | null) => {
  update(workspaceKey(hostKey, workspaceId), (diffs) =>
    diffs.active === id ? diffs : { ...diffs, active: id }
  );

  if (id !== null) activateLogTab(hostKey, workspaceId, null);
};

export const pinDiffTab = (hostKey: string, workspaceId: string, id: string) =>
  update(workspaceKey(hostKey, workspaceId), (diffs) => ({
    ...diffs,
    tabs: diffs.tabs.map((t) => (t.id === id ? { ...t, preview: false } : t)),
  }));

/** The tabs after closing `id`: back to the file tabs, else to the diff on its left. */
export const withClosed = (diffs: WorkspaceDiffs, id: string, fileTabs: boolean) => {
  const at = diffs.tabs.findIndex((tab) => tab.id === id);

  if (at === -1) return diffs;
  const tabs = diffs.tabs.filter((tab) => tab.id !== id);

  if (diffs.active !== id) return { ...diffs, tabs };

  return { tabs, active: fileTabs ? null : (tabs[Math.max(0, at - 1)]?.id ?? null) };
};

export const closeDiffTab = (hostKey: string, workspaceId: string, id: string) => {
  const key = workspaceKey(hostKey, workspaceId);
  const fileTabs = (editorStore.getState().tabs[key]?.tabs.length ?? 0) > 0;

  update(key, (diffs) => withClosed(diffs, id, fileTabs));
};

/** A file tab or a log shown in the Workspace hides its diff. */
const hideDiff = (key: string) => {
  if (diffTabStore.getState().workspaces[key]?.active != null)
    update(key, (diffs) => ({ ...diffs, active: null }));
};

editorStore.subscribe((state, previous) => {
  if (state.tabs === previous.tabs) return;

  for (const [key, set] of Object.entries(state.tabs))
    if (set !== previous.tabs[key]) hideDiff(key);
});

logTabStore.subscribe((state, previous) => {
  for (const [key, logs] of Object.entries(state.workspaces))
    if (logs.active !== null && logs.active !== previous.workspaces[key]?.active) hideDiff(key);
});

export const useDiffTabs = (hostKey: string, workspaceId: string) =>
  useStore(diffTabStore, (state) => state.workspaces[workspaceKey(hostKey, workspaceId)] ?? NONE);

/** The diff shown in a Workspace, for the Changes list's selection. */
export const useShownDiff = (hostKey: string, workspaceId: string): string | null =>
  useStore(
    diffTabStore,
    (state) => state.workspaces[workspaceKey(hostKey, workspaceId)]?.active ?? null
  );
