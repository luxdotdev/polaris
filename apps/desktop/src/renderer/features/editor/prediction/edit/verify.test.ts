import { afterEach, expect, test } from "bun:test";
import { ChangeSet } from "@codemirror/state";
import { type BufferDiagnostic, verifyDiagnostics } from "@polaris/predict";
import {
  diagnosticsVerifier,
  type DiagnosticsVerifier,
  verifyDeadline,
  type VerifyInput,
} from "../verify/index.ts";
import { cleanup, editor, editPort, final, flush, settle, type } from "./harness.testing.ts";
import { editPrediction, onPredictionLog, type PredictionLogRecord } from "./index.ts";

afterEach(cleanup);

/** A scripted server: every call to `missing` is an unresolved name. */
const errors = (text: string): BufferDiagnostic[] =>
  [...text.matchAll(/missing\(/g)].map((match) => ({
    from: match.index,
    to: match.index + 7,
    severity: "error",
    code: "2304",
    message: "Cannot find name 'missing'.",
  }));

const checked = (input: VerifyInput) => {
  const after = ChangeSet.of(
    input.edits.map((edit) => ({ from: edit.from, to: edit.to, insert: edit.text })),
    input.doc.length
  ).apply(input.doc);

  return verifyDiagnostics({
    buffer: input.doc.toString(),
    edits: input.edits,
    cursor: input.cursor,
    before: errors(input.doc.toString()),
    after: errors(after.toString()),
  });
};

interface Scripted extends DiagnosticsVerifier {
  readonly signals: AbortSignal[];
}

const verifier = (
  answer: (input: VerifyInput) => Promise<ReturnType<typeof checked> | null>,
  attached = true
): Scripted => {
  const signals: AbortSignal[] = [];

  return {
    signals,
    attached: () => attached,
    verify: (input, signal) => {
      signals.push(signal);

      return answer(input);
    },
  };
};

const never = () => new Promise<null>(() => {});

const logged = () => {
  const records: PredictionLogRecord[] = [];

  return { records, stop: onPredictionLog((record) => records.push(record)) };
};

const guards = (records: readonly PredictionLogRecord[]) =>
  records.flatMap((record) => ("guard" in record && record.guard !== null ? [record.guard] : []));

const run = async (check: Scripted, deadlineMs = 1000) => {
  const port = editPort();
  const log = logged();

  const view = editor("use(1);\n", port, 8, [
    diagnosticsVerifier.of(check),
    verifyDeadline.of(deadlineMs),
  ]);

  type(view, "x");
  await settle();

  return { port, view, log };
};

test("a Final that adds an error is never shown and is logged as a diagnostics suppression", async () => {
  const { port, view, log } = await run(verifier(async (input) => checked(input)));
  port.calls[0]?.resolve(final([{ from: 9, to: 9, text: "\nmissing();" }]));
  await flush(10);
  log.stop();

  expect(view.state.field(editPrediction)).toBeNull();
  expect(guards(log.records)).toEqual(["diagnostics"]);
});

test("a Final that adds no error shows once verified", async () => {
  const { port, view, log } = await run(verifier(async (input) => checked(input)));
  port.calls[0]?.resolve(final([{ from: 9, to: 9, text: "\nuse(2);" }]));
  await flush(10);
  log.stop();

  expect(view.state.field(editPrediction)?.hunks).toEqual([{ from: 9, to: 9, text: "\nuse(2);" }]);
  expect(guards(log.records)).toEqual([]);
});

test("with a server attached, a check past the deadline suppresses the Final", async () => {
  const check = verifier(never);
  const { port, view, log } = await run(check, 20);
  port.calls[0]?.resolve(final([{ from: 9, to: 9, text: "\nuse(2);" }]));
  await flush(5);
  expect(view.state.field(editPrediction)).toBeNull();
  await flush(40);
  log.stop();

  expect(view.state.field(editPrediction)).toBeNull();
  expect(guards(log.records)).toEqual(["diagnostics-deadline"]);
  expect(check.signals[0]?.aborted).toBe(true);
});

test("without a capable server, or when it fails, the Final shows as before", async () => {
  for (const check of [verifier(never, false), verifier(async () => null)]) {
    const { port, view, log } = await run(check, 20);
    port.calls[0]?.resolve(final([{ from: 9, to: 9, text: "\nmissing();" }]));
    await flush(5);
    log.stop();

    expect(view.state.field(editPrediction)?.hunks).toHaveLength(1);
    expect(guards(log.records)).toEqual([]);
    cleanup();
  }
});

test("a keystroke during the check cancels it: nothing shows and nothing is logged for it", async () => {
  const check = verifier(never);
  const { port, view, log } = await run(check, 1000);
  port.calls[0]?.resolve(final([{ from: 9, to: 9, text: "\nuse(2);" }]));
  await flush(5);
  expect(check.signals).toHaveLength(1);

  type(view, "y");
  await flush(5);
  log.stop();

  expect(check.signals[0]?.aborted).toBe(true);
  expect(view.state.field(editPrediction)).toBeNull();
  expect(guards(log.records)).toEqual([]);
});
