/**
 * Vim mode (spec §4), `@replit/codemirror-vim` in its own chunk, loaded only
 * once the setting is on. `:w`, `:q`, `:wq`, `:x` and `:e` go to the Editor's
 * handlers; the mode reaches the status bar through `onVimMode`.
 */
import type { Extension } from "@codemirror/state";
import { type EditorView, ViewPlugin } from "@codemirror/view";
import { type EditorFile, editorFile } from "./extensions.ts";
import { modeLabel, type VimMode } from "../model/vim.ts";

export interface VimHandlers {
  readonly save: (file: EditorFile) => Promise<boolean>;
  readonly close: (file: EditorFile) => void;
  /** `:e <path>`: the ⌘P finder, seeded with what was typed. */
  readonly find: (query: string) => void;
  readonly mode: (view: EditorView, mode: VimMode) => void;
}

type VimModule = typeof import("@replit/codemirror-vim");

let module: Promise<VimModule> | null = null;

let ready: VimModule | null = null;

let handlers: VimHandlers | null = null;

export const setVimHandlers = (next: VimHandlers) => {
  handlers = next;
};

const fileOf = (cm: { cm6: EditorView }): EditorFile | null => cm.cm6.state.facet(editorFile);

const defineCommands = ({ Vim }: VimModule) => {
  const save = async (cm: { cm6: EditorView }) => {
    const file = fileOf(cm);

    return file !== null && handlers !== null ? handlers.save(file) : false;
  };

  const close = (cm: { cm6: EditorView }) => {
    const file = fileOf(cm);

    if (file !== null) handlers?.close(file);
  };

  Vim.defineEx("write", "w", (cm) => void save(cm));
  Vim.defineEx("quit", "q", (cm) => close(cm));
  Vim.defineEx("wq", "wq", (cm) => {
    void save(cm).then((saved) => saved && close(cm));
  });
  Vim.defineEx("xit", "x", (cm) => {
    void save(cm).then((saved) => saved && close(cm));
  });
  Vim.defineEx("edit", "e", (_cm, params) => handlers?.find(params.argString.trim()));
};

const loadVim = (): Promise<VimModule> => {
  module ??= import("@replit/codemirror-vim").then((m) => {
    defineCommands(m);
    ready = m;

    return m;
  });

  return module;
};

/** Tells the status bar the mode as the user moves between them. */
const modeReporter = (getCM: VimModule["getCM"]) =>
  ViewPlugin.define((view) => {
    const cm = getCM(view);

    const report = (event: { mode: string; subMode?: string }) =>
      handlers?.mode(view, modeLabel(event.mode, event.subMode));

    cm?.on("vim-mode-change", report);
    queueMicrotask(() => handlers?.mode(view, "normal"));

    return { destroy: () => cm?.off("vim-mode-change", report) };
  });

/** The vim extension for one editor; the module loads on first use. */
export const vimExtension = async (): Promise<Extension> => {
  const m = await loadVim();

  return [m.vim(), modeReporter(m.getCM)];
};

/** Per-tab registers (spec §4): the unnamed, numbered and small-delete ones; named ones are global. */
const TAB_REGISTERS = ['"', "-", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

interface SavedRegister {
  readonly text: string;
  readonly linewise: boolean;
  readonly blockwise: boolean;
}

export type TabRegisters = ReadonlyMap<string, SavedRegister>;

/** Swaps the per-tab registers: returns the outgoing tab's, restores the incoming one's. */
export const swapRegisters = (incoming: TabRegisters | null): TabRegisters | null => {
  if (ready === null) return null;
  const controller = ready.Vim.getRegisterController();
  const out = new Map<string, SavedRegister>();

  for (const name of TAB_REGISTERS) {
    const reg = controller.getRegister(name);

    out.set(name, { text: reg.toString(), linewise: reg.linewise, blockwise: reg.blockwise });
    const next = incoming?.get(name);

    if (next === undefined) reg.clear();
    else reg.setText(next.text, next.linewise, next.blockwise);
  }

  return out;
};

/** The mode a view's vim is in now, for the status bar on a tab switch; null without vim. */
export const currentMode = (view: EditorView): VimMode | null => {
  const vim = ready?.getCM(view)?.state.vim;

  if (vim == null) return null;

  if (vim.insertMode) return "insert";

  if (vim.visualMode)
    return vim.visualBlock ? "visual block" : vim.visualLine ? "visual line" : "visual";

  return "normal";
};
