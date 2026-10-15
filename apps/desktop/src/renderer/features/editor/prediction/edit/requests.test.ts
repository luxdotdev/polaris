import { afterEach, expect, test } from "bun:test";
import { undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { setClientPlatform } from "../../../../../shared/platform.ts";
import { ghost, predictionExtension, type PredictionPort } from "../index.ts";
import {
  cleanup,
  editor,
  editPort,
  final,
  flush,
  label,
  settle,
  tab,
  type,
  views,
} from "./harness.testing.ts";
import { editPrediction, onPredictionLog, type PredictionLogRecord } from "./index.ts";

afterEach(cleanup);

test("a request starts after the pause with the frozen history and the live buffer; a keystroke cancels it", async () => {
  const port = editPort();
  const view = editor("", port);
  type(view, "a", 1000);
  type(view, "b", 2000);
  expect(port.calls).toHaveLength(0);
  await settle();
  expect(port.calls).toHaveLength(1);
  expect(port.calls[0]?.input).toEqual({
    buffer: "ab",
    cursor: 2,
    focus: null,
    history: [{ path: "", line: 0, before: "", after: "a" }],
  });
  type(view, "c", 2100);
  expect(port.calls[0]?.signal.aborted).toBe(true);
  await settle();
  expect(port.calls).toHaveLength(2);
  port.calls[1]?.resolve(final([{ from: 3, to: 3, text: "d" }]));
  await flush();
  expect(view.state.field(editPrediction)?.hunks).toEqual([{ from: 3, to: 3, text: "d" }]);
});

test("without a next-edit model the FIM ghost runs exactly as before", async () => {
  const fimCalls: string[] = [];

  const fim: PredictionPort = {
    allowed: () => true,
    request: async (input) => {
      fimCalls.push(input.buffer);

      return { text: "!" };
    },
    subscribe: () => () => {},
  };

  const port = editPort({ available: false });
  setClientPlatform("darwin");

  const view = new EditorView({
    state: EditorState.create({ doc: "", extensions: predictionExtension(fim, port) }),
    parent: document.body,
  });

  views.push(view);
  view.focus();
  type(view, "a");
  await settle();
  expect(fimCalls).toEqual(["a"]);
  expect(port.calls).toHaveLength(0);
  expect(view.state.field(ghost)?.text).toBe("!");
});

test("acceptance requests again at once from Final.cursor, with the accepted edit in the history", async () => {
  const port = editPort();
  const view = editor("const tier = tierOf(x);\nuse(tierOf", port);
  type(view, ")");
  await settle();
  port.calls[0]?.resolve(final([{ from: 13, to: 19, text: "ramTier" }], { cursor: 20 }));
  await flush(110);
  tab(view);
  expect(view.state.doc.line(1).text).toBe("const tier = ramTier(x);");
  expect(port.calls).toHaveLength(2);
  expect(port.calls[1]?.input.cursor).toBe(20);
  expect(port.calls[1]?.input.history.at(-1)).toMatchObject({ before: "tierOf", after: "ramTier" });
});

test("after an empty answer, a rename's other occurrence is probed and shown as a jump; typing cancels the probe", async () => {
  const port = editPort();
  const lines = ["const tierOf = 1;", "", "", "", "", "", "const x = tierOf;"];
  const view = editor(lines.join("\n"), port, 12);
  view.dispatch({ changes: { from: 6, to: 12, insert: "ramTier" }, selection: { anchor: 13 } });
  await settle();
  port.calls[0]?.resolve(final([], { window: { from: 0, to: 20 } }));
  await flush();
  expect(port.calls).toHaveLength(2);
  const occurrence = view.state.doc.toString().lastIndexOf("tierOf");
  expect(port.calls[1]?.input.focus).toBe(occurrence);
  port.calls[1]?.resolve(final([{ from: occurrence, to: occurrence + 6, text: "ramTier" }]));
  await flush();
  expect(label(view)).toBe("Ln 7 ↓");

  const again = editor(lines.join("\n"), port, 12);
  again.dispatch({ changes: { from: 6, to: 12, insert: "ramTier" }, selection: { anchor: 13 } });
  await settle();
  port.calls[2]?.resolve(final([], { window: { from: 0, to: 20 } }));
  await flush();
  type(again, " ");
  expect(port.calls[3]?.signal.aborted).toBe(true);
});

test("each prediction is finalized once, and an accepted one waits to see whether it is undone", async () => {
  const records: PredictionLogRecord[] = [];
  const stop = onPredictionLog((record) => records.push(record));
  const port = editPort();
  const view = editor("x = ", port, 4);
  type(view, "f");
  await settle();
  port.calls[0]?.resolve(final([{ from: 5, to: 5, text: "oo" }]));
  await flush();
  type(view, "o");
  expect(records.filter((r) => "outcome" in r).at(-1)).toMatchObject({
    outcome: "replaced-by-typing",
    kind: "insert",
    hunkCount: 1,
    model: "zeta-2.1",
    language: "unknown",
  });
  expect(records.find((r) => "keystrokes" in r)).toEqual({ keystrokes: 1 });
  await settle();
  port.calls[1]?.resolve(final([{ from: 6, to: 6, text: "();" }]));
  await flush(110);
  const before = records.length;
  tab(view);
  expect(view.state.doc.toString()).toBe("x = fo();");
  expect(records).toHaveLength(before);
  undo(view);
  expect(records.at(-1)).toMatchObject({ outcome: "accepted", undoneWithin30s: true });
  stop();
});
