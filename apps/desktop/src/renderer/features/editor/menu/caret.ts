/** Where a right-click leaves the caret, and the line ⌘L takes when nothing is selected. */
import type { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** The click's position, or null to keep the selection (the click is inside one). */
export const caretForClick = (selection: EditorSelection, pos: number | null): number | null =>
  pos === null ||
  selection.ranges.some((range) => !range.empty && range.from <= pos && pos <= range.to)
    ? null
    : pos;

/** Moves the caret to the click unless the click is inside the selection. */
export const placeCaret = (view: EditorView, x: number, y: number) => {
  const pos = caretForClick(view.state.selection, view.posAtCoords({ x, y }));

  if (pos !== null) view.dispatch({ selection: { anchor: pos }, userEvent: "select.pointer" });
};

/** With nothing selected, selects the caret's line, so it is what gets added. */
export const selectLineIfEmpty = (view: EditorView) => {
  const { main } = view.state.selection;

  if (!main.empty) return;
  const line = view.state.doc.lineAt(main.head);

  view.dispatch({ selection: { anchor: line.from, head: line.to } });
};
