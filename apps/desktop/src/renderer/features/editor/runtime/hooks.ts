/** React views of the Editor's store: a Workspace's tabs, a file's state, the active editor. */
import type { HarnessKind } from "@polaris/protocol";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { fileKey, workspaceKey } from "../model/drafts.ts";
import { tabLabels } from "../model/tabs.ts";
import { type ActiveEditor, type BufferView, editorStore, tabsOf, useEditor } from "./store.ts";

export interface TabView {
  readonly path: string;
  readonly label: string;
  readonly preview: boolean;
  readonly dirty: boolean;
  /** The Harness of a Working agent changing this file. */
  readonly agent: HarnessKind | null;
}

export interface TabsView {
  readonly tabs: ReadonlyArray<TabView>;
  readonly active: string | null;
}

const dirtyOf = (buffer: BufferView | undefined) =>
  buffer !== undefined &&
  ((buffer.status.kind === "ready" && buffer.status.model.dirty) || buffer.draft);

/** A Workspace's tabs with their labels, unsaved dots and agent marks. */
export const useEditorTabs = (hostKey: string, workspaceId: string): TabsView => {
  const key = workspaceKey(hostKey, workspaceId);
  const set = useEditor((s) => tabsOf(s, key));
  const agents = useEditor((s) => s.agentFiles[key]);

  const dirty = useEditor(
    useShallow((s) => set.tabs.map((t) => dirtyOf(s.buffers[fileKey(hostKey, t.path)])))
  );

  return useMemo(() => {
    const labels = tabLabels(set.tabs.map((t) => t.path));

    return {
      active: set.active,
      tabs: set.tabs.map((t, i) => ({
        path: t.path,
        label: labels[i] ?? t.path,
        preview: t.preview,
        dirty: dirty[i] ?? false,
        agent: agents?.get(t.path) ?? null,
      })),
    };
  }, [set, agents, dirty]);
};

export const useBuffer = (hostKey: string, path: string | null): BufferView | null =>
  useEditor((s) => (path === null ? null : (s.buffers[fileKey(hostKey, path)] ?? null)));

/** The editor in the focused pane: its file and CodeMirror view, for other features. */
export const useActiveEditor = (): ActiveEditor | null => useEditor((s) => s.active);

export const getActiveEditor = (): ActiveEditor | null => editorStore.getState().active;
