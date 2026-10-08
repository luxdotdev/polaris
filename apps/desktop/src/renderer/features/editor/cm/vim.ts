/**
 * Vim mode (spec §4), `@replit/codemirror-vim` in its own chunk, loaded only
 * once the setting is on. `:w`, `:q`, `:wq`, `:x` and `:e` go to the Editor's
 * handlers; the mode reaches the status bar through `onVimMode`. Normal-mode keys for
 * language commands (gd, K, ]d…) run those commands through the registry by id.
 */
import type { Extension } from "@codemirror/state";
import { type EditorView, ViewPlugin } from "@codemirror/view";
import { type EditorFile, editorFile } from "./extensions.ts";
import { modeLabel, type VimMode } from "../model/vim.ts";
import { LANGUAGE_NAVIGATION } from "../navigation/commands.ts";

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

/** Runs a command by id with its availability checked (the registry's `runAny`). */
let runCommand: ((id: string) => boolean) | null = null;

export const bindVimCommands = (run: (id: string) => boolean) => {
  runCommand = run;

  return () => {
    if (runCommand === run) runCommand = null;
  };
};

/** ⌃o / ⌃i with no language jump to undo walk vim's own jump list, as vim would. */
const walkJumps = (
  { Vim }: VimModule,
  cm: Parameters<Parameters<VimModule["Vim"]["defineAction"]>[1]>[0],
  step: number
) => {
  const mark = Vim.getVimGlobalState_().jumpList.move(cm, step);
  const position = mark?.find();

  if (position != null) cm.setCursor(position);
};

const FALLBACK = new Map([
  ["<C-o>", -1],
  ["<C-i>", 1],
]);

const defineLanguageKeys = (m: VimModule) => {
  for (const command of LANGUAGE_NAVIGATION) {
    for (const keys of command.vim ?? []) {
      const name = `polaris:${keys}`;

      m.Vim.defineAction(name, (cm) => {
        if (runCommand?.(command.id) === true) return;
        const step = FALLBACK.get(keys);

        if (step !== undefined) walkJumps(m, cm, step);
      });
      m.Vim.mapCommand(keys, "action", name, {}, { context: "normal" });
    }
  }
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
    defineLanguageKeys(m);
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

/*
 * Registers (unnamed, numbered, small-delete, a–z and macros) are vim's own, app-wide across
 * tabs as in real vim (the lead's call). Marks live in each tab's view, so they stay per tab.
 */

/** The mode a view's vim is in now, for the status bar on a tab switch; null without vim. */
export const currentMode = (view: EditorView): VimMode | null => {
  const vim = ready?.getCM(view)?.state.vim;

  if (vim == null) return null;

  if (vim.insertMode) return "insert";

  if (vim.visualMode)
    return vim.visualBlock ? "visual block" : vim.visualLine ? "visual line" : "visual";

  return "normal";
};
