/** View → Word wrap in the Editor: every open file's view wraps its long lines, or scrolls sideways. */
import { Compartment, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

const compartment = new Compartment();

const views = new Set<EditorView>();

let wrapping = false;

const lines = (on: boolean): Extension => (on ? EditorView.lineWrapping : []);

const reconfigure = (view: EditorView) => {
  if ((compartment.get(view.state) === EditorView.lineWrapping) !== wrapping) {
    view.dispatch({ effects: compartment.reconfigure(lines(wrapping)) });
  }
};

/** Keeps the views to reconfigure; a state made before the setting changed catches up on attach. */
const tracked = ViewPlugin.define((view) => {
  views.add(view);
  // A plugin can't dispatch while the view is still being built.
  queueMicrotask(() => {
    if (views.has(view)) reconfigure(view);
  });

  return { destroy: () => views.delete(view) };
});

export const wordWrap = (): Extension => [compartment.of(lines(wrapping)), tracked];

export const setWordWrap = (on: boolean) => {
  if (on === wrapping) return;
  wrapping = on;

  for (const view of views) reconfigure(view);
};
