/**
 * The Editor's state React reads: each Workspace's tabs, what each open file
 * shows (loading, ready, its sync with the disk), the files agents are
 * changing, and the active editor's cursor and vim mode. The editors
 * themselves (CodeMirror views) live outside it, in `buffers.ts`.
 */
import type { EditorView } from "@codemirror/view";
import type { HarnessKind } from "@polaris/protocol";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { BufferModel } from "../model/buffer.ts";
import { emptyTabs, type TabSet } from "../model/tabs.ts";
import type { LanguageId } from "../model/language.ts";
import type { VimMode } from "../model/vim.ts";
import type { AgentEdit } from "../model/agent.ts";
import type { EditorFile } from "../api.ts";

export type BufferStatus =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly model: BufferModel }
  | { readonly kind: "binary"; readonly size: number }
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly message: string };

export interface BufferView {
  readonly status: BufferStatus;
  readonly language: LanguageId;
  /** Deleted on disk while open; the text stays until the tab closes. */
  readonly deleted: boolean;
  /** The Daemon can't save here (it predates `files.write`). */
  readonly readOnly: boolean;
  /** A draft from an earlier run is waiting, before the file has loaded. */
  readonly draft: boolean;
  /** Its unsaved edit couldn't be kept on this Mac: quitting would lose it (QCHECK B1). */
  readonly unkept: boolean;
  /** Its grammar has loaded (the breadcrumb's symbol reads the syntax tree). */
  readonly grammar: boolean;
}

export interface Cursor {
  readonly line: number;
  readonly column: number;
  /** Characters selected; 0 for a caret. */
  readonly selected: number;
  /** The lines the selection covers; a selection ending at column 1 stops on the line before. */
  readonly firstLine: number;
  readonly lastLine: number;
}

export interface ActiveEditor extends EditorFile {
  readonly view: EditorView;
}

export interface EditorState {
  /** By `workspaceKey`. */
  readonly tabs: Readonly<Record<string, TabSet>>;
  /** Explicit refresh after a Settings change; no policy polling. */
  readonly previewEpochs: Readonly<Record<string, number>>;
  /** By `fileKey`. */
  readonly buffers: Readonly<Record<string, BufferView>>;
  /** By `workspaceKey`: absolute path → the Harness changing it. */
  readonly agentFiles: Readonly<Record<string, ReadonlyMap<string, HarnessKind>>>;
  readonly active: ActiveEditor | null;
  readonly cursor: Cursor | null;
  /** "Spaces 2", "Tab" for the active file. */
  readonly indent: string;
  /** Null while vim mode is off. */
  readonly vimMode: VimMode | null;
  /** By `workspaceKey`: absolute path → the agent session editing it (Paper E3). */
  readonly agentEdits: Readonly<Record<string, ReadonlyMap<string, AgentEdit>>>;
  /** The view scrolls with the agent's writes (E3's Follow, on by default). */
  readonly follow: boolean;
  /** A tab with unsaved edits waiting on Save / Don't save / Cancel. */
  readonly closing: (EditorFile & { readonly viewId?: string }) | null;
}

export const editorStore = createStore<EditorState>(() => ({
  tabs: {},
  previewEpochs: {},
  buffers: {},
  agentFiles: {},
  active: null,
  cursor: null,
  indent: "Spaces 2",
  vimMode: null,
  closing: null,
  agentEdits: {},
  follow: true,
}));

export const useEditor = <A>(select: (state: EditorState) => A): A => useStore(editorStore, select);

export const tabsOf = (state: EditorState, key: string): TabSet => state.tabs[key] ?? emptyTabs;

export const patchBuffer = (key: string, patch: Partial<BufferView>) =>
  editorStore.setState((s) => {
    const current = s.buffers[key];

    if (current === undefined) return s;

    return { buffers: { ...s.buffers, [key]: { ...current, ...patch } } };
  });

export const setBufferModel = (key: string, model: BufferModel) =>
  patchBuffer(key, { status: { kind: "ready", model }, draft: false });

export const modelOf = (key: string): BufferModel | null => {
  const status = editorStore.getState().buffers[key]?.status;

  return status?.kind === "ready" ? status.model : null;
};
