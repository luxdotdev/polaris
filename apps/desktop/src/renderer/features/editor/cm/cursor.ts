/** The status bar's position: the caret, or the lines a selection covers (Paper E2a). */
import type { EditorState } from "@codemirror/state";
import type { Cursor } from "../runtime/store.ts";

/**
 * A selection ending at column 1 (Shift+↓ over lines 10–19 ends on line 20, column 1)
 * doesn't cover that line: it reads "Ln 10–19 · 10 lines".
 */
export const cursorOf = (state: EditorState): Cursor => {
  const main = state.selection.main;
  const line = state.doc.lineAt(main.head);
  const first = state.doc.lineAt(main.from).number;
  const end = state.doc.lineAt(main.to);

  const last =
    !main.empty && main.to === end.from && end.number > first ? end.number - 1 : end.number;

  return {
    line: line.number,
    column: main.head - line.from + 1,
    selected: main.to - main.from,
    firstLine: first,
    lastLine: last,
  };
};
