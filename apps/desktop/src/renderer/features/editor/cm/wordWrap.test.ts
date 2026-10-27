import "../../../test/dom.testing.ts";
import { afterEach, expect, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { setWordWrap, wordWrap } from "./wordWrap.ts";

const views: Array<EditorView> = [];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  setWordWrap(false);
});

const stateNow = () => EditorState.create({ doc: "a long line", extensions: [wordWrap()] });

const open = (state: EditorState) => {
  const view = new EditorView({ state, parent: document.body });
  views.push(view);

  return view;
};

/** What the user sees: CodeMirror's wrapping class on the content, set as the view updates. */
const wraps = (view: EditorView) => view.contentDOM.classList.contains("cm-lineWrapping");

const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

test("turning word wrap on and off wraps every open editor's lines", () => {
  const [a, b] = [open(stateNow()), open(stateNow())];

  setWordWrap(true);
  expect([wraps(a), wraps(b)]).toEqual([true, true]);

  setWordWrap(false);
  expect([wraps(a), wraps(b)]).toEqual([false, false]);
});

test("a file opened while wrapping is on wraps from the start", () => {
  setWordWrap(true);

  expect(wraps(open(stateNow()))).toBe(true);
});

test("a buffer's state made before the setting changed catches up when it is shown", async () => {
  const kept = stateNow();

  setWordWrap(true);
  const view = open(kept);
  await settle();

  expect(wraps(view)).toBe(true);
});
