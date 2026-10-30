/** Runs one language command for an open file. */
import { startCompletion } from "@codemirror/autocomplete";
import { nextDiagnostic, previousDiagnostic } from "@codemirror/lint";
import { activateHover, type EditorView } from "@codemirror/view";
import type { LanguageQueries } from "../lsp/queries.ts";
import { showSignatureHelp } from "../lsp/signatures.ts";
import { viewOf } from "../runtime/buffers.ts";
import type { NavigationAction } from "./commands.ts";
import { editorPlaces } from "./places.ts";
import { openRename, openSymbolSearch } from "./store.ts";

/** The rename field opens on the symbol under the cursor, pre-filled with its name. */
const startRename = (key: string) => {
  const view = viewOf(key);

  if (view === null) return;
  const head = view.state.selection.main.head;
  const word = view.state.wordAt(head);
  const coords = view.coordsAtPos(word?.from ?? head);

  if (coords === null) return;
  openRename({
    key,
    initial: word === null ? "" : view.state.sliceDoc(word.from, word.to),
    left: coords.left,
    top: coords.top,
    bottom: coords.bottom,
  });
};

/** K: the hover at the cursor, as the mouse would show it; it closes when the cursor moves. */
const hoverAtCursor = (key: string) => {
  const view = viewOf(key);

  if (view === null) return;
  activateHover(view, view.state.selection.main.head, 1, {
    until: (tr) => tr.docChanged || tr.selection !== undefined,
  });
};

/** Completion and signature help open at the caret, as ⌃Space and ⌃⇧Space would. */
const atCaret = (key: string, open: (view: EditorView) => boolean) => {
  const view = viewOf(key);

  if (view === null) return;
  view.focus();
  open(view);
};

/** The cursor lands on the problem's start, as vim's ]d does, rather than selecting it. */
const problem = (key: string, step: (view: EditorView) => boolean) => {
  const view = viewOf(key);

  if (view === null || !step(view)) return;
  view.dispatch({ selection: { anchor: view.state.selection.main.from } });
};

export const runNavigation = (
  key: string,
  action: NavigationAction,
  queries: Pick<LanguageQueries, "run"> | null
) => {
  if (action === "back") editorPlaces.back();
  else if (action === "forward") editorPlaces.forward();
  else if (action === "hover") hoverAtCursor(key);
  else if (action === "completion") atCaret(key, startCompletion);
  else if (action === "signature-help") atCaret(key, showSignatureHelp);
  else if (action === "next-problem") problem(key, nextDiagnostic);
  else if (action === "previous-problem") problem(key, previousDiagnostic);
  else if (action === "rename-field") startRename(key);
  else if (action === "symbol-search") openSymbolSearch(key);
  else void queries?.run(key, action);
};
