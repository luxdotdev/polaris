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
import { agentMarks } from "../cm/agent.ts";
import { editorLook } from "../cm/theme.ts";
import { detectIndent, type Indent, lineSeparatorOf } from "../model/indent.ts";

export const languageCompartment = new Compartment();

export const vimCompartment = new Compartment();

export const readOnlyCompartment = new Compartment();

/** Which file the state holds; a rename reconfigures it. */
export const fileCompartment = new Compartment();

/** The file's own line endings; a reload that changes them reconfigures it, so saves keep the disk's. */
export const lineEndingCompartment = new Compartment();

export const lineEnding = (separator: "\r\n" | "\n"): Extension =>
  separator === "\r\n" ? EditorState.lineSeparator.of("\r\n") : [];

const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);

/** Built once: the keys with every shell chord taken out. */
let keys: Extension | null = null;

const editorKeys = () => {
  keys ??= keymap.of([
    ...shellSafe([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab], mac),
  ]);

  return keys;
};

/** CodeMirror's own words in sentence case (rule/sentence-case). */
const PHRASES = EditorState.phrases.of({
  Find: "Find",
  Replace: "Replace",
  next: "Next",
  previous: "Previous",
  all: "All",
  "match case": "Match case",
  regexp: "Regex",
  "by word": "Whole word",
  replace: "Replace",
  "replace all": "Replace all",
  close: "Close",
  "current match": "Current match",
  "on line": "on line",
  "Go to line": "Go to line",
  go: "Go",
});

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
      fileCompartment.of(editorFile.of(file)),
      lineEndingCompartment.of(lineEnding(separator)),
      EditorState.tabSize.of(indent.width),
      indentUnit.of(indent.tabs ? "\t" : " ".repeat(indent.width)),
      // The agent's bar first: it overlays the git bar's place on the lines it wrote.
      agentMarks,
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
      PHRASES,
      reloadHighlight,
      languageCompartment.of([]),
      readOnlyCompartment.of(readOnly ? EditorState.readOnly.of(true) : []),
      EditorView.contentAttributes.of({ "aria-label": `Editing ${file.path}` }),
      onUpdate,
    ],
  });

  return { state, indent };
};
