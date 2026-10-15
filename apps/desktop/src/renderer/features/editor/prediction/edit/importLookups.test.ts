import { afterEach, expect, test } from "bun:test";
import { undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { type ImportCandidate, importSource } from "../imports/index.ts";
import {
  cleanup,
  editor,
  editPort,
  type FakeEditPort,
  final,
  flush,
  hint,
  label,
  press,
  settle,
  tab,
  type,
} from "./harness.testing.ts";
import {
  editPrediction,
  onPredictionLog,
  type PredictionLogRecord,
  visibleEditPrediction,
} from "./index.ts";

afterEach(cleanup);

const TITLE = 'Add import from "./probe.ts"';

const IMPORT = 'import { hostCanServe } from "./probe.ts";\n';

const DOC = 'import type { A } from "./types.ts";\n\nconst ok = hostCanServe';

interface Lookup {
  readonly range: { readonly from: number; readonly to: number };
  readonly signal: AbortSignal;
  readonly resolve: (candidate: ImportCandidate | null) => void;
}

const imports = () => {
  const lookups: Lookup[] = [];
  let fence = true;

  const source = importSource.of({
    find: (range, signal) => new Promise((resolve) => lookups.push({ range, signal, resolve })),
  });

  return {
    lookups,
    source,
    stale: () => {
      fence = false;
    },
    candidate: (view: EditorView): ImportCandidate => ({
      title: TITLE,
      hunks: [{ from: 0, to: 0, text: IMPORT }],
      doc: view.state.doc,
      current: () => fence,
    }),
  };
};

/** Types "(" after the unresolved name and lets the burst settle with the model idle. */
const settled = async (port: FakeEditPort = editPort()) => {
  const fake = imports();
  const view = editor(DOC, port, DOC.length, fake.source);
  type(view, "(");
  await settle();

  return { view, port, fake };
};

test("after a burst settles the changed lines are asked about, and the fix shows as the server's title", async () => {
  const { view, port, fake } = await settled();
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  expect(fake.lookups.map((lookup) => lookup.range)).toEqual([{ from: line.from, to: line.to }]);

  port.calls[0]?.resolve(final([]));
  await flush();
  fake.lookups[0]?.resolve(fake.candidate(view));
  await flush();
  expect(label(view)).toBe(TITLE);
  expect(view.state.doc.toString()).toBe(`${DOC}(`);
});

test("Tab applies the server's insertion as one undo step and logs it as an import", async () => {
  const records: PredictionLogRecord[] = [];
  const stop = onPredictionLog((record) => records.push(record));
  const { view, port, fake } = await settled();
  port.calls[0]?.resolve(final([]));
  fake.lookups[0]?.resolve(fake.candidate(view));
  await flush(110);
  tab(view);
  expect(view.state.doc.toString()).toBe(`${IMPORT}${DOC}(`);
  expect(view.state.selection.main.head).toBe(IMPORT.length + DOC.length + 1);

  undo(view);
  expect(view.state.doc.toString()).toBe(`${DOC}(`);
  expect(records.filter((r) => "outcome" in r).at(-1)).toMatchObject({
    kind: "import",
    outcome: "accepted",
    format: null,
    hunkCount: 1,
    linesAdded: 1,
    undoneWithin30s: true,
  });
  stop();
});

test("a fix whose language server fence no longer holds is never applied", async () => {
  const { view, port, fake } = await settled();
  port.calls[0]?.resolve(final([]));
  fake.lookups[0]?.resolve(fake.candidate(view));
  await flush(110);
  fake.stale();
  tab(view);
  expect(view.state.doc.toString()).not.toContain("hostCanServe }");
  expect(view.state.field(editPrediction)).toBeNull();
});

test("a model prediction wins: the import waits for the model, and shows only if the model has none", async () => {
  const shown = await settled();
  shown.fake.lookups[0]?.resolve(shown.fake.candidate(shown.view));
  await flush();
  expect(hint(shown.view)).toBeNull();
  const end = shown.view.state.doc.length;
  shown.port.calls[0]?.resolve(final([{ from: end, to: end, text: "16)" }]));
  await flush();
  expect(visibleEditPrediction(shown.view.state)?.import).toBeUndefined();
  expect(label(shown.view)).toBeNull();

  const empty = await settled();
  empty.fake.lookups[0]?.resolve(empty.fake.candidate(empty.view));
  await flush();
  expect(hint(empty.view)).toBeNull();
  empty.port.calls[0]?.resolve(final([]));
  await flush();
  expect(label(empty.view)).toBe(TITLE);
});

test("the import obeys the guards: Tab inside 100 ms types, and Esc keeps the line quiet", async () => {
  const quick = await settled();
  quick.port.calls[0]?.resolve(final([]));
  quick.fake.lookups[0]?.resolve(quick.fake.candidate(quick.view));
  await flush();
  tab(quick.view);
  expect(quick.view.state.doc.toString()).not.toContain(IMPORT);

  const esc = await settled();
  press(esc.view, "Escape");
  expect(esc.fake.lookups[0]?.signal.aborted).toBe(true);
  type(esc.view, "1");
  await settle();
  expect(esc.fake.lookups).toHaveLength(1);
  expect(hint(esc.view)).toBeNull();
});
