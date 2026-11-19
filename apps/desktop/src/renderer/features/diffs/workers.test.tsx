import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, spyOn, test } from "bun:test";
import { DIFF_HIGHLIGHTER, THEMES } from "./theme.ts";
import { DiffWorkers } from "./workers.tsx";

// Pierre logs a worker's error event when no onWorkerError is set; these tests cause them.
const quiet = spyOn(console, "error").mockImplementation(() => undefined);

afterEach(() => {
  cleanup();
  quiet.mockClear();
});

const diff = parseDiffFromFile(
  { name: "a.ts", contents: "const a = 1;\nexport default a;\n" },
  { name: "a.ts", contents: "const a = 2;\nexport default a;\n" }
);

/** A worker that starts, then reports an error instead of answering its first message. */
class ErroringWorker extends Worker {
  constructor() {
    super("data:text/javascript,");
  }

  override postMessage() {
    queueMicrotask(() => this.dispatchEvent(new Event("error")));
  }
}

const throwing = (): Worker => {
  throw new Error("worker script failed to load");
};

const erroring = () => new ErroringWorker();

/** The text of each line Pierre drew, in its shadow root. */
const linesOf = (container: HTMLElement) =>
  [
    ...(container.querySelector("diffs-container")?.shadowRoot?.querySelectorAll("[data-line]") ??
      []),
  ].map((line) => line.textContent);

test.each([
  ["the worker can't be made", throwing],
  ["the worker errors on start", erroring],
])("when %s, the diff still shows", async (_, factory) => {
  let made = 0;

  const workerFactory = () => {
    made += 1;

    return factory();
  };

  const { container } = render(
    <DiffWorkers workerFactory={workerFactory} poolSize={1}>
      <FileDiff
        fileDiff={diff}
        options={{ theme: THEMES, themeType: "dark", preferredHighlighter: DIFF_HIGHLIGHTER }}
      />
    </DiffWorkers>
  );

  await waitFor(() =>
    expect(linesOf(container)).toEqual([
      "const a = 1;",
      "export default a;",
      "const a = 2;",
      "export default a;",
    ])
  );
  // The pool really tried a worker, so the diff came from the fallback.
  expect(made).toBeGreaterThan(0);
});
