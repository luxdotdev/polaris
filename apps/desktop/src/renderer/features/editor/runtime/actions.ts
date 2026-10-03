/**
 * What other features call: open a file in a Workspace's Edit mode, close
 * and cycle tabs, save, and tell the Editor which files agents are changing.
 * Tabs persist per Workspace; a file's editor lives while any tab shows it.
 */
import type { SaveReason } from "../formatting/index.ts";
import type { HarnessKind } from "@polaris/protocol";
import {
  closeTab as closeInSet,
  activateTab as activateInSet,
  activeTabId,
  followMarkdown,
  openMarkdown,
  lockMarkdown,
  tabId,
  cycleTab,
  movedPath,
  openTab,
  pinTab,
  renameTab,
  type TabSet,
} from "../model/tabs.ts";
import { fileKey, readTabs, workspaceKey, writeTabs } from "../model/drafts.ts";
import {
  configureEditor,
  type EditorConfig,
  discardBuffer,
  ensureBuffer,
  hasUnsaved,
  hostOf,
  moveBuffer,
  isConfigured,
  keepMine,
  releaseBuffer,
  saveBuffer,
  takeTheirs,
  whenLoaded,
} from "./buffers.ts";
import { editorStore, tabsOf } from "./store.ts";
import { unreadableToast } from "../model/notices.ts";
import type { AgentEdit } from "../model/agent.ts";
import { loadLazyExtensions, type OpenFileRequest, openFile, takeOpens } from "../api.ts";

export { openFile, type OpenFileRequest };

import type { EditorFile } from "../cm/extensions.ts";
import { languageFor } from "../model/language.ts";
import { showOpenFailure } from "../ui/toasts.ts";

/** Each Workspace's root as its pane last said, for relative paths and tree watches. */
const roots = new Map<string, string>();

export const setWorkspaceRoot = (hostKey: string, workspaceId: string, root: string) =>
  roots.set(workspaceKey(hostKey, workspaceId), root);

const resolve = (root: string | undefined, path: string) =>
  path.startsWith("/") || root === undefined
    ? path
    : `${root.replace(/\/$/, "")}/${path.replace(/^\.\//, "")}`;

const setTabs = (key: string, update: (set: TabSet) => TabSet) =>
  editorStore.setState((s) => {
    const before = tabsOf(s, key);
    const after = update(before);

    if (after === before) return s;

    for (const path of new Set(before.tabs.map((t) => t.path))) {
      if (!after.tabs.some((t) => t.path === path)) {
        const hostKey = key.slice(0, key.indexOf("\u0000"));
        queueMicrotask(() => {
          if (!shown(hostKey, path)) releaseBuffer(fileKey(hostKey, path));
        });
      }
    }
    // Unchanged tabs keep their object, so typing doesn't wake the tab strip or the tabs' save.

    return { tabs: { ...s.tabs, [key]: after } };
  });

const followDocument = (set: TabSet, path: string, hostKey: string) => {
  const rendered = set.tabs.find((t) => t.view === "markdown");
  const keep = rendered !== undefined && isConfigured() && hasUnsaved(hostKey, rendered.path);

  return followMarkdown(set, path, keep);
};

/** An edit pins its file's preview tab. */
const pinOnEdit = (file: EditorFile) =>
  setTabs(workspaceKey(file.hostKey, file.workspaceId), (set) => pinTab(set, file.path));

/** Whether any Workspace still has a tab on this file. */
const shown = (hostKey: string, path: string) =>
  Object.entries(editorStore.getState().tabs).some(
    ([key, set]) => key.startsWith(`${hostKey}\u0000`) && set.tabs.some((t) => t.path === path)
  );

const closeNow = (hostKey: string, workspaceId: string, id: string) => {
  setTabs(workspaceKey(hostKey, workspaceId), (set) => closeInSet(set, id));
};

/** Closes a tab; one with unsaved edits asks Save / Don't save / Cancel first. */
export const closeTab = (hostKey: string, workspaceId: string, id: string) => {
  const ws = workspaceKey(hostKey, workspaceId);
  const set = tabsOf(editorStore.getState(), ws);
  const tab = set.tabs.find((t) => tabId(t) === id);

  if (tab === undefined) return;

  const shared = Object.entries(editorStore.getState().tabs).some(
    ([key, other]) =>
      key.startsWith(`${hostKey}\u0000`) &&
      other.tabs.some((t) => t.path === tab.path && (key !== ws || tabId(t) !== id))
  );

  if (!shared && isConfigured() && hasUnsaved(hostKey, tab.path)) {
    editorStore.setState({ closing: { hostKey, workspaceId, path: tab.path, viewId: id } });

    return;
  }

  closeNow(hostKey, workspaceId, id);
};

export type CloseChoice = "save" | "discard" | "cancel";

/** The close prompt's answer. Save closes only once the file saved; a conflict keeps it open. */
export const answerClose = async (choice: CloseChoice) => {
  const closing = editorStore.getState().closing;

  editorStore.setState({ closing: null });

  if (closing === null || choice === "cancel") return;
  const { hostKey, workspaceId, path, viewId = path } = closing;

  const current = tabsOf(editorStore.getState(), workspaceKey(hostKey, workspaceId)).tabs.find(
    (t) => tabId(t) === viewId
  );

  if (current?.path !== path) return;

  if (choice === "discard") {
    const unchanged = () =>
      tabsOf(editorStore.getState(), workspaceKey(hostKey, workspaceId)).tabs.find(
        (tab) => tabId(tab) === viewId
      ) === current && current.path === path;

    const shared = () =>
      Object.entries(editorStore.getState().tabs).some(
        ([key, set]) =>
          key.startsWith(`${hostKey}\u0000`) &&
          set.tabs.some(
            (tab) =>
              tab.path === path &&
              (key !== workspaceKey(hostKey, workspaceId) || tabId(tab) !== viewId)
          )
      );

    if (!shared() && !(await discardBuffer(hostKey, path, () => unchanged() && !shared()))) return;

    if (unchanged()) closeNow(hostKey, workspaceId, viewId);

    return;
  }

  const key = fileKey(hostKey, path);

  loadTab(hostKey, workspaceId, path);
  await whenLoaded(key);

  if (!(await saveBuffer(key, "close"))) return;

  const latest = tabsOf(editorStore.getState(), workspaceKey(hostKey, workspaceId)).tabs.find(
    (t) => tabId(t) === viewId
  );

  // Immutable tab identity fences retargets and close/reopen, including returning to the same path.
  if (latest === current && latest.path === path) closeNow(hostKey, workspaceId, viewId);
};

/** Makes sure the active tab's file has an editor (after a restart, tabs come back first). */
export const loadTab = (hostKey: string, workspaceId: string, path: string) => {
  const ws = workspaceKey(hostKey, workspaceId);

  ensureBuffer({
    file: { hostKey, workspaceId, path },
    root: roots.get(ws) ?? path.slice(0, path.lastIndexOf("/")),
    line: null,
    column: null,
    onEdit: pinOnEdit,
    onDirectory: () => closeTab(hostKey, workspaceId, path),
  });
};

/** `api.ts`'s `openFile` lands here once the Editor has started (earlier calls wait there). */
const openFileNow = (request: OpenFileRequest) => {
  const { hostKey, workspaceId } = request;
  const ws = workspaceKey(hostKey, workspaceId);
  const root = roots.get(ws);
  const path = resolve(root, request.path);

  setTabs(ws, (set) => {
    const opened = openTab(set, path, request.preview ?? false);
    const next = languageFor(path) === "markdown" ? followDocument(opened, path, hostKey) : opened;

    return next;
  });

  ensureBuffer({
    file: { hostKey, workspaceId, path },
    root: root ?? path.slice(0, path.lastIndexOf("/")),
    line: request.line ?? null,
    column: request.column ?? null,
    onEdit: pinOnEdit,
    onDirectory: () => closeTab(hostKey, workspaceId, path),
    onUnreadable: (reason) => {
      closeNow(hostKey, workspaceId, path);
      showOpenFailure(unreadableToast(path, root ?? null, hostOf(hostKey), reason));
    },
  });
};

export const activateTab = (hostKey: string, workspaceId: string, id: string) =>
  setTabs(workspaceKey(hostKey, workspaceId), (set) => {
    const next = activateInSet(set, id);

    return next.activeView !== "markdown" &&
      next.active !== null &&
      languageFor(next.active) === "markdown"
      ? followDocument(next, next.active, hostKey)
      : next;
  });

export const openMarkdownPreview = (hostKey: string, workspaceId: string) => {
  const ws = workspaceKey(hostKey, workspaceId);
  const set = tabsOf(editorStore.getState(), ws);

  if (set.active === null || languageFor(set.active) !== "markdown") return;
  const path = set.active;
  loadTab(hostKey, workspaceId, path);
  setTabs(ws, (current) =>
    openMarkdown(followDocument(pinTab(current, path), path, hostKey), path)
  );
};

export const setMarkdownLocked = (hostKey: string, workspaceId: string, locked: boolean) =>
  setTabs(workspaceKey(hostKey, workspaceId), (set) => lockMarkdown(set, locked));

/** Settings calls this after changing remembered preview policy. */
export const refreshMarkdownPolicy = (hostKey: string, workspaceId: string) => {
  const key = workspaceKey(hostKey, workspaceId);
  editorStore.setState((s) => ({
    previewEpochs: {
      ...s.previewEpochs,
      [key]: (s.previewEpochs[key] ?? 0) + 1,
    },
  }));
};

export const closeActiveTab = (hostKey: string, workspaceId: string) => {
  const id = activeTabId(tabsOf(editorStore.getState(), workspaceKey(hostKey, workspaceId)));

  if (id !== null) closeTab(hostKey, workspaceId, id);
};

export const pinFile = (hostKey: string, workspaceId: string, path: string) =>
  setTabs(workspaceKey(hostKey, workspaceId), (set) => pinTab(set, path));

export const cycleTabs = (hostKey: string, workspaceId: string, delta: 1 | -1) =>
  setTabs(workspaceKey(hostKey, workspaceId), (set) => {
    const next = cycleTab(set, delta);

    return next.activeView !== "markdown" &&
      next.active !== null &&
      languageFor(next.active) === "markdown"
      ? followDocument(next, next.active, hostKey)
      : next;
  });

/** A file or folder renamed in the explorer keeps its tabs; their editors reopen at the new paths. */
export const renameFile = async (hostKey: string, from: string, to: string) => {
  const paths = new Set(
    Object.values(editorStore.getState().tabs).flatMap((set) => set.tabs.map((t) => t.path))
  );

  const moves = [...paths].flatMap((path) => {
    const moved = movedPath(path, from, to);

    return moved === path ? [] : [moveBuffer(hostKey, path, moved)];
  });

  // The drafts move first, so the tabs reopen with their unsaved edits.
  await Promise.all(moves);
  editorStore.setState((s) => ({
    tabs: Object.fromEntries(
      Object.entries(s.tabs).map(([key, set]) => [
        key,
        key.startsWith(`${hostKey}\u0000`) ? renameTab(set, from, to) : set,
      ])
    ),
  }));
};

export const saveFile = (hostKey: string, path: string, reason?: SaveReason) =>
  saveBuffer(fileKey(hostKey, path), reason);

export const keepMyEdits = (hostKey: string, path: string) => keepMine(fileKey(hostKey, path));

export const takeDiskVersion = (hostKey: string, path: string) =>
  takeTheirs(fileKey(hostKey, path));

/** The explorer's publisher: which files a Working agent is changing in this Workspace. */
export const setAgentFiles = (
  hostKey: string,
  workspaceId: string,
  files: ReadonlyMap<string, HarnessKind>
) =>
  editorStore.setState((s) => ({
    agentFiles: { ...s.agentFiles, [workspaceKey(hostKey, workspaceId)]: files },
  }));

/** The explorer's feed for E3: which agent session is editing which file in this Workspace. */
export const setAgentEdits = (
  hostKey: string,
  workspaceId: string,
  edits: ReadonlyMap<string, AgentEdit>
) =>
  editorStore.setState((s) => ({
    agentEdits: { ...s.agentEdits, [workspaceKey(hostKey, workspaceId)]: edits },
  }));

export const setFollow = (follow: boolean) => editorStore.setState({ follow });

let unpersist: (() => void) | null = null;

/** Sets up the Editor once per window: its files, drafts, prefs; restores the tabs. */
export const startEditor = (config: EditorConfig) => {
  configureEditor(config);
  const kv = config.kv;

  unpersist?.();
  unpersist = null;

  if (kv !== null) editorStore.setState({ tabs: readTabs(kv) });

  takeOpens(openFileNow);
  loadLazyExtensions();

  if (kv === null) return;
  let timer: ReturnType<typeof setTimeout> | null = null;

  unpersist = editorStore.subscribe((state, prev) => {
    if (state.tabs === prev.tabs) return;

    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => writeTabs(kv, editorStore.getState().tabs), 300);
  });
};
