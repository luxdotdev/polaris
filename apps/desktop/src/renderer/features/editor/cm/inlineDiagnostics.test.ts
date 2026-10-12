import "../../../test/dom.testing.ts";
import { afterEach, expect, test } from "bun:test";
import { autocompletion, startCompletion } from "@codemirror/autocomplete";
import { type Diagnostic, setDiagnostics } from "@codemirror/lint";
import { EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { inlineDiagnostics, setInlineDiagnostics, summarise } from "./inlineDiagnostics.ts";

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
  setInlineDiagnostics(true);
});

const DOC = "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n";

const at = (line: number, severity: Diagnostic["severity"], message: string): Diagnostic => {
  const from = Text.of(DOC.split("\n")).line(line).from;

  return { from: from + 6, to: from + 7, severity, message };
};

const DIAGNOSTICS = [
  at(1, "warning", "Prefer const."),
  at(1, "error", "Type 'number' is not assignable to type 'string'.\n  More detail."),
  at(1, "hint", "unused"),
  at(2, "hint", "'b' is declared but its value is never read."),
  at(3, "info", "A note."),
];

const editor = () => {
  view = new EditorView({
    state: EditorState.create({
      doc: DOC,
      extensions: [
        inlineDiagnostics,
        autocompletion({ override: [() => ({ from: 0, options: [{ label: "x" }] })] }),
      ],
    }),
    parent: document.body,
  });
  view.dispatch(setDiagnostics(view.state, DIAGNOSTICS));

  return view;
};

const messages = (v: EditorView) =>
  [...v.dom.querySelectorAll(".cm-inlineDiagnostic")].map((node) => [
    node.className.replace("cm-inlineDiagnostic ", ""),
    node.textContent,
  ]);

const marks = (v: EditorView) =>
  [...v.dom.querySelectorAll(".cm-diagnosticMark")].map((node) =>
    node.className.replace("cm-diagnosticMark ", "")
  );

test("a line shows its most severe diagnostic's first line, with a count of the rest", () => {
  const lines = summarise(Text.of(DOC.split("\n")), DIAGNOSTICS);
  const found: [number, string, string, number][] = [];
  lines.between(0, DOC.length, (from, _to, value) => {
    found.push([from, value.severity, value.message, value.more]);
  });
  expect(found).toEqual([
    [0, "error", "Type 'number' is not assignable to type 'string'.", 1],
    [13, "hint", "'b' is declared but its value is never read.", 0],
    [26, "info", "A note.", 0],
  ]);
});

test("every line gets a mark; hints get no message", () => {
  const v = editor();
  expect(marks(v)).toEqual([
    "cm-diagnosticMark-error",
    "cm-diagnosticMark-hint",
    "cm-diagnosticMark-info",
  ]);
  expect(messages(v)).toEqual([
    ["cm-inlineDiagnostic-error", "Type 'number' is not assignable to type 'string'.+1"],
    ["cm-inlineDiagnostic-info", "A note."],
  ]);
});

test("the setting hides the messages and keeps the marks", () => {
  const v = editor();
  setInlineDiagnostics(false);
  expect(messages(v)).toEqual([]);
  expect(marks(v)).toHaveLength(3);
  setInlineDiagnostics(true);
  expect(messages(v)).toHaveLength(2);
});

test("the cursor line holds its message while the completion popup is up", () => {
  const v = editor();
  v.dispatch({ selection: { anchor: 3 } });
  startCompletion(v);
  expect(messages(v)).toEqual([["cm-inlineDiagnostic-info", "A note."]]);
});

test("new diagnostics replace the old ones", () => {
  const v = editor();
  v.dispatch(setDiagnostics(v.state, []));
  expect(messages(v)).toEqual([]);
  expect(marks(v)).toEqual([]);
});
