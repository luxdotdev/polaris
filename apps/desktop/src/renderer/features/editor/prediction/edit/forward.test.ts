import { afterEach, expect, jest, test } from "bun:test";
import { undo } from "@codemirror/commands";
import { cleanup, editor, editPort, show, tab, type } from "./harness.testing.ts";
import { forwardPredictionLog, type PredictionNotify } from "./forward.ts";
import { type PredictionLogRecord, UNDO_WINDOW_MS } from "./outcomes.ts";

afterEach(() => {
  jest.useRealTimers();
  cleanup();
});

const recorder = () => {
  const sent: Array<readonly [string, PredictionLogRecord]> = [];

  // SAFETY: both channels carry a PredictionLogRecord; the test notify only records it.
  const notify = ((method: string, input: PredictionLogRecord) => {
    sent.push([method, input]);
  }) as PredictionNotify;

  return { sent, stop: forwardPredictionLog(() => notify) };
};

const microtasks = () => Promise.resolve();

const acceptOne = () => {
  const view = editor("x = ", editPort(), 4);
  type(view, "f");
  type(view, "o");
  show(view, [{ from: 6, to: 6, text: "();" }]);
  tab(view);
  expect(view.state.doc.toString()).toBe("x = fo();");

  return view;
};

test("shown, accepted, then undone reaches main as one outcome after the keystrokes before it", async () => {
  const { sent, stop } = recorder();
  jest.useFakeTimers();
  const view = acceptOne();
  await microtasks();
  expect(sent).toEqual([]);

  undo(view);
  await microtasks();
  expect(sent).toEqual([
    ["prediction.keystrokes", { keystrokes: 2 }],
    [
      "prediction.outcome",
      expect.objectContaining({ outcome: "accepted", kind: "insert", undoneWithin30s: true }),
    ],
  ]);
  jest.advanceTimersByTime(UNDO_WINDOW_MS);
  await microtasks();
  expect(sent).toHaveLength(2);
  stop();
});

test("an acceptance not undone within 30 s is sent once when the window closes; a later undo adds nothing", async () => {
  const { sent, stop } = recorder();
  jest.useFakeTimers();
  const view = acceptOne();
  jest.advanceTimersByTime(UNDO_WINDOW_MS);
  await microtasks();
  const outcomes = () => sent.filter(([method]) => method === "prediction.outcome");
  expect(outcomes()).toEqual([
    [
      "prediction.outcome",
      expect.objectContaining({ outcome: "accepted", undoneWithin30s: false }),
    ],
  ]);

  undo(view);
  await microtasks();
  expect(outcomes()).toHaveLength(1);
  stop();
});

test("stopping sends what is still queued", () => {
  const { sent, stop } = recorder();
  const view = editor("x = ", editPort(), 4);
  type(view, "a");
  view.destroy();
  stop();
  expect(sent).toEqual([["prediction.keystrokes", { keystrokes: 1 }]]);
});
