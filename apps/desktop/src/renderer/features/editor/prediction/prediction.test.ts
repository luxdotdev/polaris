import "../../../test/dom.testing.ts";
import { afterEach, expect, test } from "bun:test";
import {
  autocompletion,
  snippet,
  startCompletion,
  nextSnippetField,
} from "@codemirror/autocomplete";
import { undo, history, indentWithTab } from "@codemirror/commands";
import { EditorState, type Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { setClientPlatform } from "../../../../shared/platform.ts";
import { vimExtension } from "../cm/vim.ts";
import {
  acceptPrediction,
  ghost,
  predictionExtension,
  setGhost,
  visibleGhost,
  type PredictionPort,
} from "./index.ts";

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
    view.dom.remove();
  }

  setClientPlatform(null);
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const idle: PredictionPort = {
  allowed: () => true,
  request: async () => ({ text: "" }),
  subscribe: () => () => {},
};

const editor = (doc = "foo", port = idle, extra: Parameters<typeof EditorState.create>[0] = {}) => {
  setClientPlatform("darwin");

  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
      ...extra,
      extensions: [
        history(),
        keymap.of([indentWithTab]),
        predictionExtension(port),
        extra.extensions ?? [],
      ],
    }),
    parent: document.body,
  });

  views.push(view);
  view.focus();

  return view;
};

const press = (view: EditorView, key: string, code: string, keyCode: number, altKey = false) =>
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", { key, code, keyCode, altKey, bubbles: true, cancelable: true })
  );

test("single and multi-line authoritative predictions accept with Tab and undo together", () => {
  const view = editor("return ");
  view.dispatch({ effects: setGhost.of({ at: 7, text: "value;\nnext();" }) });
  expect(view.dom.querySelector(".cm-prediction-inline")?.textContent).toBe("value;Tab");
  expect(view.dom.querySelector(".cm-prediction-block")?.textContent).toBe("next();");
  expect(press(view, "Tab", "Tab", 9)).toBe(false);
  expect(view.state.doc.toString()).toBe("return value;\nnext();");
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("return ");
});

test("word acceptance keeps the authoritative remainder; Esc dismisses it", () => {
  const view = editor();
  view.dispatch({ effects: setGhost.of({ at: 3, text: "Bar.baz" }) });
  press(view, "ArrowRight", "ArrowRight", 39, true);
  expect(view.state.doc.toString()).toBe("fooBar");
  expect(view.state.field(ghost)?.text).toBe(".baz");
  expect(press(view, "Escape", "Escape", 27)).toBe(false);
  expect(view.state.field(ghost)).toBeNull();
});

test("an active snippet keeps Tab and suppresses the ghost", () => {
  let state = EditorState.create({ extensions: predictionExtension(idle) });

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
    effects: setGhost.of({ at: state.selection.main.head, text: "ghost" }),
  }).state;
  expect(visibleGhost(state)).toBeNull();
  expect(nextSnippetField(target)).toBe(true);
  expect(state.sliceDoc(state.selection.main.from, state.selection.main.to)).toBe("two");
});

test("LSP popup hides the ghost and takes acceptance", async () => {
  const view = editor("al", idle, {
    extensions: autocompletion({
      override: [() => ({ from: 0, options: [{ label: "alpha" }] })],
      activateOnTyping: false,
    }),
  });

  view.dispatch({ effects: setGhost.of({ at: 2, text: "ternate" }) });
  startCompletion(view);

  for (let i = 0; i < 40 && view.dom.querySelector(".cm-tooltip-autocomplete") === null; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(view.dom.querySelector(".cm-tooltip-autocomplete")).not.toBeNull();
  expect(view.dom.querySelector(".cm-prediction-inline")).toBeNull();
  expect(acceptPrediction(view)).toBe(false);
  press(view, "Escape", "Escape", 27);
  expect(view.dom.querySelector(".cm-tooltip-autocomplete") === null).toBe(true);
  expect(view.state.field(ghost)).toBeNull();
});

test("every edit starts immediately, aborts its predecessor and ignores stale results", async () => {
  const signals: AbortSignal[] = [];
  const resolve: ((value: { text: string }) => void)[] = [];

  const view = editor("", {
    ...idle,
    request: (_input, signal) => {
      signals.push(signal);

      return new Promise((done) => resolve.push(done));
    },
  });

  view.dispatch({ changes: { from: 0, insert: "a" }, selection: { anchor: 1 } });
  view.dispatch({ changes: { from: 1, insert: "b" }, selection: { anchor: 2 } });
  expect(signals).toHaveLength(2);
  expect(signals[0]?.aborted).toBe(true);
  resolve[0]?.({ text: "stale" });
  await flush();
  expect(view.state.field(ghost)).toBeNull();
  resolve[1]?.({ text: "fresh" });
  await flush();
  expect(view.state.field(ghost)?.text).toBe("fresh");
});

test("offline/configuration refresh aborts pending work and clears visible ghost", async () => {
  let refresh = () => {};

  const signals: AbortSignal[] = [];
  let held: ((value: { text: string }) => void) | null = null;
  let hold = false;
  let allowed = true;

  const view = editor("", {
    allowed: () => allowed,
    subscribe: (next) => {
      refresh = next;

      return () => {};
    },
    request: (_input, signal) => {
      signals.push(signal);

      return hold ? new Promise((done) => (held = done)) : Promise.resolve({ text: "ready" });
    },
  });

  view.dispatch({ changes: { from: 0, insert: "a" }, selection: { anchor: 1 } });
  await flush();
  expect(view.state.field(ghost)?.text).toBe("ready");
  allowed = false;
  refresh();
  expect(view.state.field(ghost)).toBeNull();

  allowed = true;
  hold = true;
  view.dispatch({ changes: { from: 1, insert: "b" }, selection: { anchor: 2 } });
  const pending = signals.at(-1);

  expect(pending?.aborted).toBe(false);
  refresh();
  expect(pending?.aborted).toBe(true);
  held?.({ text: "late" });
  await flush();
  expect(view.state.field(ghost)).toBeNull();
});

test("future additional edits are atomic, fenced, and applied only once on word acceptance", () => {
  const view = editor("head\nfoo");
  view.dispatch({
    effects: setGhost.of({
      at: 8,
      text: "Bar.baz",
      additionalEdits: [{ from: 0, to: 4, insert: "import x", expected: "head" }],
    }),
  });
  expect(acceptPrediction(view, true)).toBe(true);
  expect(view.state.doc.toString()).toBe("import x\nfooBar");
  expect(acceptPrediction(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("import x\nfooBar.baz");
  view.dispatch({
    effects: setGhost.of({
      at: view.state.doc.length,
      text: "!",
      additionalEdits: [{ from: 0, to: 4, insert: "bad", expected: "old" }],
    }),
  });
  expect(acceptPrediction(view)).toBe(false);
  expect(view.state.doc.toString()).not.toContain("bad");
});

test("highest Tab binding accepts in vim insert mode and otherwise leaves normal mode alone", async () => {
  const view = editor("foo", idle, { extensions: await vimExtension() });
  const { Vim, getCM } = await import("@replit/codemirror-vim");
  const cm = getCM(view);

  if (cm === null) throw new Error("vim did not attach");
  expect(acceptPrediction(view)).toBe(false);
  Vim.handleKey(cm, "A", "user");
  view.dispatch({ effects: setGhost.of({ at: 3, text: "Bar" }) });
  press(view, "Tab", "Tab", 9);
  expect(view.state.doc.toString()).toBe("fooBar");
});

test("Tab without ghost falls through to indent", () => {
  const view = editor("");
  press(view, "Tab", "Tab", 9);
  expect(view.state.doc.toString()).toBe("  ");
});

const streaming = () => {
  const pending = Promise.withResolvers<{ text: string }>();
  let preview: ((text: string) => void) | undefined;

  const view = editor("return", {
    ...idle,
    request: (_input, _signal, next) => {
      preview = next;

      return pending.promise;
    },
  });

  view.dispatch({ changes: { from: 6, insert: " " }, selection: { anchor: 7 } });

  return { view, pending, preview: (text: string) => preview?.(text) };
};

test("provisional line is visible but cannot be accepted; Final authorizes only the shown prefix", async () => {
  const { view, pending, preview } = streaming();
  preview("value; ");
  await flush();
  expect(view.dom.querySelector(".cm-prediction-inline")?.textContent).toBe("value; ");
  expect(view.dom.querySelector(".cm-prediction-key")).toBeNull();
  expect(acceptPrediction(view)).toBe(false);
  expect(acceptPrediction(view, true)).toBe(false);
  expect(view.state.doc.toString()).toBe("return ");
  pending.resolve({ text: "value; unseen();" });
  await flush();
  expect(view.dom.querySelector(".cm-prediction-key")).not.toBeNull();
  expect(acceptPrediction(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("return value; ");
  expect(acceptPrediction(view)).toBe(false);
});

test("Final can retract overlap or all text without leaving provisional content acceptable", async () => {
  const { view, pending, preview } = streaming();
  preview("value;\n");
  await flush();
  pending.resolve({ text: "value" });
  await flush();
  expect(view.state.field(ghost)?.text).toBe("value");
  expect(acceptPrediction(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("return value");
  const next = streaming();
  next.preview("suffix;");
  await flush();
  next.pending.resolve({ text: "" });
  await flush();
  expect(next.view.state.field(ghost)).toBeNull();
});

test("failed streams clear provisional text and Escape ignores late preview and Final", async () => {
  const failed = streaming();
  failed.preview("value; ");
  await flush();
  failed.pending.reject(new Error("endpoint failed"));
  await flush();
  expect(failed.view.state.field(ghost)).toBeNull();
  const canceled = streaming();
  canceled.preview("value; ");
  await flush();
  press(canceled.view, "Escape", "Escape", 27);
  canceled.preview("late; ");
  canceled.pending.resolve({ text: "late; " });
  await flush();
  expect(canceled.view.state.field(ghost)).toBeNull();
});

test("a fallback reset clears the first endpoint's preview", async () => {
  const { view, pending, preview } = streaming();
  preview("first; ");
  await flush();
  preview("");
  await flush();
  expect(view.state.field(ghost)).toBeNull();
  preview("second; ");
  await flush();
  pending.resolve({ text: "second; " });
  await flush();
  expect(acceptPrediction(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("return second; ");
});

test("focus loss clears a provisional ghost and ignores its late Final", async () => {
  const { view, pending, preview } = streaming();
  preview("value; ");
  await flush();
  view.contentDOM.blur();
  view.dispatch({});
  await flush();
  expect(view.state.field(ghost)).toBeNull();
  pending.resolve({ text: "value; " });
  await flush();
  expect(view.state.field(ghost)).toBeNull();
});
