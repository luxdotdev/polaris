/**
 * Log tabs (DESIGN.md, Editor: Language server log; Paper L6): read-only tabs after a
 * Workspace's file tabs. The feed is live-only, so log tabs are never persisted or restored.
 */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { workspaceKey } from "../model/drafts.ts";
import { editorStore } from "../runtime/store.ts";
import { logKey, type LogScope } from "./log.ts";

export interface LogTab {
  readonly id: string;
  readonly scope: LogScope;
  /** "TypeScript": the tab reads "TypeScript log". */
  readonly language: string;
}

interface WorkspaceLogs {
  readonly tabs: readonly LogTab[];
  readonly active: string | null;
}

const NONE: WorkspaceLogs = { tabs: [], active: null };

export const logTabStore = createStore<{
  readonly workspaces: Readonly<Record<string, WorkspaceLogs>>;
}>(() => ({ workspaces: {} }));

export const LOG_TAB_PREFIX = "language-log:";

export const logTabId = (scope: LogScope) => LOG_TAB_PREFIX + logKey(scope);

export const isLogTab = (id: string) => id.startsWith(LOG_TAB_PREFIX);

const update = (key: string, change: (logs: WorkspaceLogs) => WorkspaceLogs) =>
  logTabStore.setState((state) => {
    const before = state.workspaces[key] ?? NONE;
    const after = change(before);

    return after === before ? state : { workspaces: { ...state.workspaces, [key]: after } };
  });

/** Opens (or shows) the log for one language server on one Host, in the given Workspace's tabs. */
export const openLanguageLog = (
  scope: LogScope,
  language: string,
  workspaceId: string = scope.checkout.workspaceId
) => {
  const id = logTabId(scope);

  update(workspaceKey(scope.hostKey, workspaceId), (logs) => ({
    tabs: logs.tabs.some((tab) => tab.id === id)
      ? logs.tabs
      : [...logs.tabs, { id, scope, language }],
    active: id,
  }));
};

export const activateLogTab = (hostKey: string, workspaceId: string, id: string | null) =>
  update(workspaceKey(hostKey, workspaceId), (logs) =>
    logs.active === id ? logs : { ...logs, active: id }
  );

export const closeLogTab = (hostKey: string, workspaceId: string, id: string) =>
  update(workspaceKey(hostKey, workspaceId), (logs) => {
    const at = logs.tabs.findIndex((tab) => tab.id === id);

    if (at === -1) return logs;
    const tabs = logs.tabs.filter((tab) => tab.id !== id);

    if (logs.active !== id) return { ...logs, tabs };

    const editorHasTabs =
      (editorStore.getState().tabs[workspaceKey(hostKey, workspaceId)]?.tabs.length ?? 0) > 0;

    // Closing the shown log returns to the file tabs, else to the log on its left.
    return {
      tabs,
      active: editorHasTabs ? null : (tabs[Math.max(0, at - 1)]?.id ?? null),
    };
  });

/** Any change to a Workspace's file tabs (open, select, close) shows the file again. */
editorStore.subscribe((state, previous) => {
  if (state.tabs === previous.tabs) return;

  for (const [key, set] of Object.entries(state.tabs))
    if (set !== previous.tabs[key] && logTabStore.getState().workspaces[key]?.active != null)
      update(key, (logs) => ({ ...logs, active: null }));
});

export const useLogTabs = (hostKey: string, workspaceId: string) =>
  useStore(logTabStore, (state) => state.workspaces[workspaceKey(hostKey, workspaceId)] ?? NONE);
