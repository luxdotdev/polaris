import { afterEach, expect, test } from "bun:test";
import { undo } from "@codemirror/commands";
import { cleanup, editor, editPort, hint, label, press, show, tab } from "./harness.testing.ts";
import { editPrediction } from "./index.ts";

afterEach(cleanup);

const text = (view: ReturnType<typeof editor>, selector: string) =>
  [...view.dom.querySelectorAll(selector)].map((node) => node.textContent);

test("a replace within a line strikes the old text, ghosts the new text after it, and shows a bare keycap", () => {
  const view = editor("const tier = tierOf(x);", undefined, 13);
  show(view, [{ from: 13, to: 19, text: "ramTier" }]);
  expect(text(view, ".cm-ep-removed")).toEqual(["tierOf"]);
  expect(text(view, ".cm-ep-added")).toEqual(["ramTier"]);
  expect(hint(view)?.querySelector(".cm-prediction-key")?.textContent).toBe("Tab");
  expect(label(view)).toBeNull();
  expect(view.dom.querySelectorAll(".cm-ep-hint")).toHaveLength(1);
});

test("a multi-line replace tints the removed lines and reserves a ghost block below them with the keycap on its first line", () => {
  const doc = "a\nexport const f = (m) => one(m) || two(m);\nconst z = 1;";
  const view = editor(doc, undefined, doc.length);
  const line = view.state.doc.line(2);
  show(view, [
    {
      from: line.from,
      to: line.to + 1,
      text: "export const f = (m) =>\n  one(m) || two(m) || three(m);\n",
    },
  ]);
  expect(view.dom.querySelectorAll(".cm-ep-removed-line")).toHaveLength(1);
  expect(text(view, ".cm-ep-struck")).toEqual(["export const f = (m) => one(m) || two(m);"]);
  expect(text(view, ".cm-ep-block-line > span:first-child")).toEqual([
    "export const f = (m) =>",
    "  one(m) || two(m) || three(m);",
  ]);
  expect(view.dom.querySelector(".cm-ep-block-line .cm-ep-hint")).not.toBeNull();
  expect(view.dom.querySelectorAll(".cm-ep-hint")).toHaveLength(1);
});

test("a deletion tints and strikes its lines with the count at the end of the first", () => {
  const view = editor("keep\ngone 1\ngone 2\ngone 3\nkeep", undefined, 5);
  const { doc } = view.state;
  show(view, [{ from: doc.line(2).from, to: doc.line(5).from, text: "" }]);
  expect(view.dom.querySelectorAll(".cm-ep-removed-line")).toHaveLength(3);
  expect(label(view)).toBe("delete 3 lines");
  expect(hint(view)?.closest(".cm-line")?.textContent).toContain("gone 1");
  tab(view);
  expect(view.state.doc.toString()).toBe("keep\nkeep");
});

test("a jump shows only the hint with the target line; Tab moves there and reveals the edit, then applies it", () => {
  const lines = Array.from({ length: 12 }, (_, i) => `line ${i + 1} x`);
  const view = editor(lines.join("\n"), undefined, 8);
  const target = view.state.doc.line(9);
  show(view, [{ from: target.to - 1, to: target.to, text: "y" }]);
  expect(label(view)).toBe("Ln 9 ↓");
  expect(view.dom.querySelector(".cm-ep-removed")).toBeNull();
  tab(view);
  expect(view.state.selection.main.head).toBe(target.to - 1);
  expect(view.state.field(editPrediction)?.phase).toBe("jumped");
  expect(text(view, ".cm-ep-removed")).toEqual(["x"]);
  expect(label(view)).toBeNull();
  tab(view);
  expect(view.state.doc.line(9).text).toBe("line 9 y");
  const up = editor(lines.join("\n"), undefined, view.state.doc.line(12).to);
  show(up, [{ from: 0, to: 4, text: "LINE" }]);
  expect(label(up)).toBe("Ln 1 ↑");
});

test("Subtle display shows only the keycap, previews in place while ⌥ is held, and still accepts", () => {
  const view = editor("const tier = tierOf(x);", editPort({ display: "subtle" }), 13);
  show(view, [{ from: 13, to: 19, text: "ramTier" }]);
  expect(hint(view)).not.toBeNull();
  expect(label(view)).toBeNull();
  expect(view.dom.querySelector(".cm-ep-removed")).toBeNull();
  press(view, "Alt", true);
  expect(text(view, ".cm-ep-removed")).toEqual(["tierOf"]);
  view.contentDOM.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", bubbles: true }));
  expect(view.dom.querySelector(".cm-ep-removed")).toBeNull();
  tab(view);
  expect(view.state.doc.toString()).toBe("const tier = ramTier(x);");
  const jump = editor("a\nb\nc\nd\ne", editPort({ display: "subtle" }), 0);
  show(jump, [{ from: 8, to: 9, text: "E" }]);
  expect(label(jump)).toBe("↓");
});

test("Tab applies every hunk as one undo step and moves the cursor to Final.cursor", () => {
  const view = editor("foo(a);\nbar(a);", undefined, 7);
  show(
    view,
    [
      { from: 4, to: 5, text: "b" },
      { from: 12, to: 13, text: "b" },
    ],
    { cursor: 3 }
  );
  tab(view);
  expect(view.state.doc.toString()).toBe("foo(b);\nbar(b);");
  expect(view.state.selection.main.head).toBe(3);
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("foo(a);\nbar(a);");
});
