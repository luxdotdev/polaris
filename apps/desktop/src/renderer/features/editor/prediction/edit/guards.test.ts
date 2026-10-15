import { afterEach, expect, test } from "bun:test";
import { autocompletion, snippet, startCompletion } from "@codemirror/autocomplete";
import { EditorState, type Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { predictionExtension } from "../index.ts";
import {
  cleanup,
  editor,
  editPort,
  fim,
  final,
  flush,
  label,
  press,
  settle,
  show,
  tab,
  type,
} from "./harness.testing.ts";
import {
  editPrediction,
  onPredictionLog,
  type PredictionLogRecord,
  setEditPrediction,
  showLastEditPrediction,
  visibleEditPrediction,
} from "./index.ts";

afterEach(cleanup);

const REPLACE = [{ from: 13, to: 19, text: "ramTier" }];

test("Tab within 100 ms of a prediction appearing types a Tab instead", () => {
  const view = editor("const tier = tierOf(x);", undefined, 13);
  show(view, REPLACE, { shownAt: performance.now() });
  tab(view);
  expect(view.state.doc.toString()).toBe("  const tier = tierOf(x);");
  const again = editor("const tier = tierOf(x);", undefined, 13);
  show(again, REPLACE);
  tab(again);
  expect(again.state.doc.toString()).toBe("const tier = ramTier(x);");
});

test("Tab in leading whitespace indents unless the first hunk is on the cursor line", () => {
  const away = editor("  foo\nbar", undefined, 1);
  show(away, [{ from: 6, to: 9, text: "baz" }]);
  tab(away);
  expect(away.state.doc.toString()).toBe("    foo\nbar");
  const here = editor("  foo\nbar", undefined, 1);
  show(here, [{ from: 2, to: 5, text: "fox" }]);
  tab(here);
  expect(here.state.doc.toString()).toBe("  fox\nbar");
});

test("Esc keeps predictions off the line until the cursor leaves it; the command brings the last one back", async () => {
  const port = editPort();
  const view = editor("a\nb", port, 1);
  type(view, "x");
  await settle();
  expect(port.calls).toHaveLength(1);
  port.calls[0]?.resolve(final([{ from: 2, to: 2, text: "y" }]));
  await flush();
  expect(view.state.field(editPrediction)).not.toBeNull();
  expect(
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
    )
  ).toBe(false);
  expect(view.state.field(editPrediction)).toBeNull();
  expect(showLastEditPrediction(view)).toBe(true);
  expect(view.state.field(editPrediction)?.hunks).toEqual([{ from: 2, to: 2, text: "y" }]);
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
  );
  type(view, "z");
  await settle();
  expect(port.calls).toHaveLength(1);
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  type(view, "w");
  await settle();
  expect(port.calls).toHaveLength(2);
});

test("Enter on the suppressed line lifts the suppression", async () => {
  const port = editPort();
  const view = editor("a", port);
  type(view, "x");
  await settle();
  port.calls[0]?.resolve(final([{ from: 2, to: 2, text: "y" }]));
  await flush();
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
  );
  type(view, "\n");
  await settle();
  expect(port.calls).toHaveLength(2);
});

test("no request while a selection is non-empty", async () => {
  const port = editPort();
  const view = editor("abc", port);
  view.dispatch({ changes: { from: 3, insert: "d" }, selection: { anchor: 1, head: 3 } });
  await settle();
  expect(port.calls).toHaveLength(0);
});

test("nothing is shown or requested during a mouse selection", async () => {
  const port = editPort();
  const view = editor("abcd", port);
  show(view, [{ from: 4, to: 4, text: "e" }]);
  expect(visibleEditPrediction(view.state)).not.toBeNull();
  view.contentDOM.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }));
  await flush();
  expect(visibleEditPrediction(view.state)).toBeNull();
  expect(view.dom.querySelector(".cm-ep-added")).toBeNull();
  type(view, "f");
  await settle();
  expect(port.calls).toHaveLength(0);
  show(view, [{ from: 5, to: 5, text: "g" }]);
  window.dispatchEvent(new PointerEvent("pointerup", { button: 0 }));
  await flush();
  expect(visibleEditPrediction(view.state)).not.toBeNull();
  expect(view.dom.querySelector(".cm-ep-added")?.textContent).toBe("g");
});

test("a snippet field hides the prediction and keeps Tab", () => {
  let state = EditorState.create({ extensions: predictionExtension(fim, editPort()) });

  const target = {
    get state() {
      return state;
    },
    dispatch: (tr: Transaction) => {
      state = tr.state;
    },
  };

  snippet("${one} ${two}")(target, null, 0, 0);
  state = state.update({
    effects: setEditPrediction.of({
      id: "t",
      hunks: [{ from: 0, to: 3, text: "uno" }],
      cursor: null,
      window: { from: 0, to: 7 },
      doc: state.doc,
      anchor: 0,
      phase: "shown",
      shownAt: 0,
      finalToShown: 0,
      model: "zeta-2.1",
      format: "zeta-2.1",
      side: "client",
      requestToFinal: 1,
    }),
  }).state;
  expect(visibleEditPrediction(state)).toBeNull();
});

test("a deletion of more than 5 lines needs a second Tab", () => {
  const doc = Array.from({ length: 9 }, (_, i) => `line ${i + 1}`).join("\n");
  const view = editor(doc, undefined, 0);
  const to = view.state.doc.line(8).from;
  show(view, [{ from: 0, to, text: "" }]);
  expect(label(view)).toBe("delete 7 lines");
  tab(view);
  expect(view.state.doc.toString()).toBe(doc);
  expect(label(view)).toBe("again to delete 7 lines");
  tab(view);
  expect(view.state.doc.toString()).toBe("line 8\nline 9");
  const small = editor("a\nb\nc\nd", undefined, 0);
  show(small, [{ from: 0, to: 4, text: "" }]);
  expect(label(small)).toBe("delete 2 lines");
  tab(small);
  expect(small.state.doc.toString()).toBe("c\nd");
});

test("a prediction that recreates text deleted this burst, or removes text typed this burst, is never shown", async () => {
  const outcomes: PredictionLogRecord[] = [];
  const stop = onPredictionLog((record) => outcomes.push(record));
  const last = () => outcomes.findLast((record) => "guard" in record);
  const port = editPort();
  const view = editor("alpha beta", port);
  view.dispatch({
    changes: { from: 5, to: 10 },
    selection: { anchor: 5 },
    userEvent: "delete.backward",
  });
  await settle();
  expect(port.calls).toHaveLength(1);
  port.calls[0]?.resolve(final([{ from: 5, to: 5, text: " beta" }]));
  await flush();
  expect(view.state.field(editPrediction)).toBeNull();
  expect(last()).toMatchObject({ guard: "recent-edit", outcome: null, finalToShownMs: null });

  const typed = editor("x = ", port, 4);
  type(typed, "foo");
  await settle();
  port.calls[1]?.resolve(final([{ from: 4, to: 7, text: "bar" }]));
  await flush();
  expect(typed.state.field(editPrediction)).toBeNull();
  expect(last()).toMatchObject({ guard: "recent-edit", kind: "replace" });

  const fine = editor("x = ", port, 4);
  type(fine, "foo");
  await settle();
  port.calls[2]?.resolve(final([{ from: 7, to: 7, text: "();" }]));
  await flush();
  expect(fine.state.field(editPrediction)?.hunks).toEqual([{ from: 7, to: 7, text: "();" }]);
  stop();
});

test("Conservative settings drop jumps and large deletions before they are shown", async () => {
  const port = editPort({ jumpsOffered: false, largeDeletionsOffered: false });
  const doc = Array.from({ length: 9 }, (_, i) => `line ${i + 1}`).join("\n");
  const view = editor(doc, port, 6);
  type(view, " ");
  await settle();
  port.calls[0]?.resolve(
    final([{ from: view.state.doc.line(8).from, to: view.state.doc.line(8).to, text: "far" }])
  );
  await flush();
  expect(view.state.field(editPrediction)).toBeNull();
});

const pendingSource = () => {
  const finishers: Array<() => void> = [];

  return {
    extension: autocompletion({
      activateOnTyping: true,
      activateOnTypingDelay: 0,
      override: [() => new Promise((resolve) => finishers.push(() => resolve(null)))],
    }),
    finish: () => {
      for (const finish of finishers) finish();
    },
  };
};

const popupSource = autocompletion({
  activateOnTyping: false,
  override: [
    (context) => ({ from: context.pos, options: [{ label: "alpha" }, { label: "beta" }] }),
  ],
});

const openPopup = async (view: EditorView) => {
  startCompletion(view);

  for (let i = 0; i < 40 && view.dom.querySelector(".cm-tooltip-autocomplete") === null; i++)
    await flush(10);
  expect(view.dom.querySelector(".cm-tooltip-autocomplete")).not.toBeNull();
};

test("a completion source still pending at the pause doesn't hold the request back", async () => {
  const port = editPort();
  const source = pendingSource();
  const view = editor("ab", port, 2, source.extension);
  type(view, "c");
  await settle();
  expect(port.calls).toHaveLength(1);
  source.finish();
  await settle();
  expect(port.calls).toHaveLength(1);
});

test("an open completion list wins: no request until it closes, then the pause runs again", async () => {
  const port = editPort({ pauseMs: 60 });
  const view = editor("ab", port, 2, popupSource);
  type(view, "c");
  await openPopup(view);
  await flush(90);
  expect(port.calls).toHaveLength(0);
  press(view, "Escape");
  expect(view.dom.querySelector(".cm-tooltip-autocomplete")).toBeNull();
  await flush(90);
  expect(port.calls).toHaveLength(1);
});

test("Esc over an open completion list drops the hidden prediction without suppressing the line", async () => {
  const port = editPort();
  const view = editor("ab", port, 2, popupSource);
  show(view, [{ from: 2, to: 2, text: "c" }]);
  await openPopup(view);
  expect(visibleEditPrediction(view.state)).toBeNull();
  press(view, "Escape");
  expect(view.state.field(editPrediction)).toBeNull();
  type(view, "z");
  await settle();
  expect(port.calls).toHaveLength(1);
});
