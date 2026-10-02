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
import type { EditorFile } from "../cm/extensions.ts";

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
  /** Its grammar has loaded (the breadcrumb's symbol reads the syntax tree). */
  readonly grammar: boolean;
}

export interface Cursor {
  readonly line: number;
  readonly column: number;
  /** Characters selected; 0 for a caret. */
  readonly selected: number;
  /** Lines the selection spans. */
  readonly lines: number;
}

export interface ActiveEditor extends EditorFile {
  readonly view: EditorView;
}

export interface EditorState {
  /** By `workspaceKey`. */
  readonly tabs: Readonly<Record<string, TabSet>>;
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
}

export const editorStore = createStore<EditorState>(() => ({
  tabs: {},
  buffers: {},
  agentFiles: {},
  active: null,
  cursor: null,
  indent: "Spaces 2",
  vimMode: null,
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
