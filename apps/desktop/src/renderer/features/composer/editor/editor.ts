/**
 * The composer's Lexical editor on its core API: plain text, history, chips,
 * and the keys. React only mounts it (`../ui/PromptEditor.tsx`); every handler
 * reads the latest callbacks through `hooks()`, so nothing re-registers on render.
 */
import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import { registerPlainText } from "@lexical/plain-text";
import { mergeRegister } from "@lexical/utils";
import {
  $getRoot,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_NORMAL,
  COPY_COMMAND,
  createEditor,
  CUT_COMMAND,
  DROP_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalEditor,
  PASTE_COMMAND,
  SELECTION_CHANGE_COMMAND,
  $getSelection,
  $isRangeSelection,
  CLEAR_HISTORY_COMMAND,
  SKIP_DOM_SELECTION_TAG,
} from "lexical";
import type { CommandOption, Draft } from "../model/commands.ts";
import { CommandNode } from "./node.ts";
import { $caretAcrossChip, $followDomCaret, $selectionText, $snapOutOfChip } from "./selection.ts";
import {
  $insertChip,
  $readDraft,
  $readTypedWord,
  $removeTypedWord,
  $retokenize,
  $setText,
  registerChips,
  type TypedWord,
} from "./state.ts";

export interface EditorHooks {
  readonly options: () => ReadonlyArray<CommandOption>;
  readonly onDraft: (draft: Draft) => void;
  readonly onTypedWord: (word: TypedWord | null) => void;
  /** While the menu is open it owns ↑ ↓ ⇥ ↵ and esc. */
  readonly menu: {
    readonly open: () => boolean;
    readonly move: (by: 1 | -1) => void;
    readonly pick: () => void;
    readonly dismiss: () => void;
  };
  /** ↵ sends; with ⌘ or Ctrl, `queue` is true. */
  readonly onSubmit: (queue: boolean) => void;
  /** esc outside the menu; true when it did something (stopped the Turn). */
  readonly onEscape: () => boolean;
  /** Whether pasted or dropped files go to attachments, so their names aren't typed in. */
  readonly takesFiles: () => boolean;
}

/** Undo groups keystrokes this close together, as a textarea does. */
const HISTORY_DELAY_MS = 300;

const hasFiles = (data: DataTransfer | null) => data !== null && data.types.includes("Files");

export interface PromptEditor {
  readonly editor: LexicalEditor;
  readonly mount: (root: HTMLElement) => () => void;
  readonly setText: (text: string) => void;
  readonly insertChip: (option: CommandOption) => void;
  readonly removeTypedWord: () => void;
  readonly retokenize: () => void;
  readonly focus: () => void;
  /** The word under the caret and the draft, as the editor stands now. */
  readonly read: () => { readonly typed: TypedWord | null; readonly draft: Draft };
}

/** The keys: the menu's first while it is open, then ↵ to send and esc to stop. */
const registerKeys = (editor: LexicalEditor, hooks: () => EditorHooks) => {
  const whileMenu = (run: (h: EditorHooks) => void) => (event: KeyboardEvent | null) => {
    const h = hooks();

    if (event?.isComposing || !h.menu.open()) return false;
    event?.preventDefault();
    run(h);

    return true;
  };

  const across = (direction: "left" | "right") => (event: KeyboardEvent) => {
    if (!$caretAcrossChip(direction, event.shiftKey)) return false;
    event.preventDefault();

    return true;
  };

  const high = COMMAND_PRIORITY_HIGH;

  return mergeRegister(
    // First on every key: the commands below act on the caret the user sees.
    editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event) => {
        if (!event.isComposing) $followDomCaret(editor);

        return false;
      },
      COMMAND_PRIORITY_CRITICAL
    ),
    editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      whileMenu((h) => h.menu.move(1)),
      high
    ),
    editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      whileMenu((h) => h.menu.move(-1)),
      high
    ),
    editor.registerCommand(
      KEY_TAB_COMMAND,
      whileMenu((h) => h.menu.pick()),
      high
    ),
    editor.registerCommand(
      KEY_ENTER_COMMAND,
      whileMenu((h) => h.menu.pick()),
      high
    ),
    editor.registerCommand(KEY_ARROW_LEFT_COMMAND, across("left"), high),
    editor.registerCommand(KEY_ARROW_RIGHT_COMMAND, across("right"), high),
    editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (event) => {
        const h = hooks();

        if (event.isComposing) return false;

        if (h.menu.open()) h.menu.dismiss();
        else if (!h.onEscape()) return false;
        event.preventDefault();

        return true;
      },
      high
    ),
    editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if (event === null || event.isComposing || event.shiftKey) return false;
        event.preventDefault();
        hooks().onSubmit(event.metaKey || event.ctrlKey);

        return true;
      },
      COMMAND_PRIORITY_NORMAL
    )
  );
};

/** Copy and cut keep a chip's sigil; a selection without chips is Lexical's to copy. */
const copyWithSigils = (cut: boolean) => (event: ClipboardEvent | KeyboardEvent | null) => {
  if (!(event instanceof ClipboardEvent) || event.clipboardData === null) return false;
  const text = $selectionText();

  if (text === null) return false;
  event.preventDefault();
  event.clipboardData.setData("text/plain", text);
  const selection = $getSelection();

  if (cut && $isRangeSelection(selection)) selection.removeText();

  return true;
};

export const createPromptEditor = (hooks: () => EditorHooks, label: string): PromptEditor => {
  const editor = createEditor({
    namespace: "polaris-composer",
    nodes: [CommandNode],
    onError: (error) => {
      throw error;
    },
  });

  const register = () => {
    const files = (data: DataTransfer | null) => hasFiles(data) && hooks().takesFiles();

    return mergeRegister(
      registerPlainText(editor),
      registerHistory(editor, createEmptyHistoryState(), HISTORY_DELAY_MS),
      registerChips(editor, () => hooks().options()),
      registerKeys(editor, hooks),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          $snapOutOfChip();

          return false;
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(COPY_COMMAND, copyWithSigils(false), COMMAND_PRIORITY_LOW),
      editor.registerCommand(CUT_COMMAND, copyWithSigils(true), COMMAND_PRIORITY_LOW),
      // The attachments wrapper takes the files as the event bubbles; only keep Lexical from typing names.
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          if (!(event instanceof ClipboardEvent) || !files(event.clipboardData)) return false;
          event.preventDefault();

          return true;
        },
        COMMAND_PRIORITY_HIGH
      ),
      editor.registerCommand(
        DROP_COMMAND,
        (event) => {
          if (!files(event.dataTransfer)) return false;
          event.preventDefault();

          return true;
        },
        COMMAND_PRIORITY_HIGH
      ),
      editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
        const typed = editorState.read($readTypedWord);

        hooks().onTypedWord(typed);

        if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
        hooks().onDraft(editorState.read($readDraft));
      })
    );
  };

  return {
    editor,
    mount: (root) => {
      root.setAttribute("aria-label", label);
      editor.setRootElement(root);
      const unregister = register();

      return () => {
        unregister();
        editor.setRootElement(null);
      };
    },
    setText: (text) => {
      const root = editor.getRootElement();
      const focused = root !== null && root.contains(document.activeElement);

      // A hidden session's composer must not take focus; nor is a set from outside undoable.
      editor.update(() => $setText(text, focused), {
        tag: focused ? [] : [SKIP_DOM_SELECTION_TAG],
        onUpdate: () => editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined),
      });
    },
    insertChip: (option) => editor.update(() => $insertChip(option)),
    removeTypedWord: () => editor.update(() => $removeTypedWord()),
    retokenize: () => editor.update(() => $retokenize()),
    read: () =>
      editor.getEditorState().read(() => ({ typed: $readTypedWord(), draft: $readDraft() })),
    focus: () =>
      editor.focus(undefined, {
        defaultSelection:
          editor.getEditorState().read(() => $getRoot().getTextContentSize()) > 0
            ? "rootEnd"
            : "rootStart",
      }),
  };
};
