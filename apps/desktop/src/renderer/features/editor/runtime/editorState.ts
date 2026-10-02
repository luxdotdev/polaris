/**
 * One file's CodeMirror state: the shared look and keys, its own line
 * endings and indentation, and compartments for what arrives later (its
 * grammar, vim mode, other features' extensions).
 */
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, indentUnit } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  type EditorFile,
  editorFile,
  registeredCompartment,
  registeredExtensions,
} from "../cm/extensions.ts";
import { shellSafe } from "../cm/keys.ts";
import { reloadHighlight } from "../cm/reload.ts";
import { editorLook } from "../cm/theme.ts";
import { detectIndent, type Indent, lineSeparatorOf } from "../model/indent.ts";

export const languageCompartment = new Compartment();

export const vimCompartment = new Compartment();

export const readOnlyCompartment = new Compartment();

const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);

/** Built once: the keys with every shell chord taken out. */
let keys: Extension | null = null;

const editorKeys = () => {
  keys ??= keymap.of([
    ...shellSafe([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab], mac),
  ]);

  return keys;
};

export interface StateInput {
  readonly file: EditorFile;
  readonly text: string;
  readonly readOnly: boolean;
  /** Vim's extension when the setting is on and it has loaded. */
  readonly vim: Extension;
  /** Called with every update while the state is in a view. */
  readonly onUpdate: Extension;
}

export interface FileState {
  readonly state: EditorState;
  readonly indent: Indent;
}

export const createFileState = ({ file, text, readOnly, vim, onUpdate }: StateInput): FileState => {
  const indent = detectIndent(text);
  const separator = lineSeparatorOf(text);

  const state = EditorState.create({
    doc: text,
    extensions: [
      // Vim first, so its keys win over the editor's (codemirror-vim's README).
      vimCompartment.of(vim),
      editorFile.of(file),
      separator === "\r\n" ? EditorState.lineSeparator.of("\r\n") : [],
      EditorState.tabSize.of(indent.width),
      indentUnit.of(indent.tabs ? "\t" : " ".repeat(indent.width)),
      // Before the line numbers, so a registered gutter (the git bars) sits left of them.
      registeredCompartment.of(registeredExtensions(file)),
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      bracketMatching(),
      highlightSelectionMatches(),
      search({ top: true }),
      editorKeys(),
      editorLook,
      reloadHighlight,
      languageCompartment.of([]),
      readOnlyCompartment.of(readOnly ? EditorState.readOnly.of(true) : []),
      EditorView.contentAttributes.of({ "aria-label": `Editing ${file.path}` }),
      onUpdate,
    ],
  });

  return { state, indent };
};
