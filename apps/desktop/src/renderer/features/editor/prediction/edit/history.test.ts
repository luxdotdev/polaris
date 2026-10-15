import { afterEach, expect, test } from "bun:test";
import { Transaction } from "@codemirror/state";
import { cleanup, editor, show, tab, type } from "./harness.testing.ts";
import { historyOf, MAX_HISTORY_HUNKS } from "./index.ts";

afterEach(cleanup);

test("typing coalesces into one hunk per burst, frozen at the first keystroke after a 500 ms pause", () => {
  const view = editor("");
  type(view, "a", 1000);
  type(view, "b", 1010);
  type(view, "c", 1020);
  expect(historyOf(view.state).frozen).toEqual([]);
  type(view, "d", 1400);
  expect(historyOf(view.state).frozen).toEqual([]);
  type(view, "e", 1900);
  expect(historyOf(view.state).frozen).toEqual([{ path: "", line: 0, before: "", after: "abcd" }]);
  type(view, "f", 1950);
  expect(historyOf(view.state).frozen).toHaveLength(1);
  type(view, "g", 3000);
  expect(historyOf(view.state).frozen.at(-1)).toEqual({
    path: "",
    line: 0,
    before: "",
    after: "ef",
  });
});

test("a deletion inside the burst records what was removed, on the line after the edit", () => {
  const view = editor("one\ntwo", undefined, 7);
  view.dispatch({ changes: { from: 4, to: 7 }, annotations: Transaction.time.of(1000) });
  type(view, "2", 10_000);
  expect(historyOf(view.state).frozen).toEqual([{ path: "", line: 1, before: "two", after: "" }]);
});

test("history keeps only the newest 32 hunks", () => {
  const view = editor("");

  for (let i = 0; i < MAX_HISTORY_HUNKS + 8; i++)
    type(view, String.fromCharCode(97 + (i % 26)), i * 1000);
  const { frozen } = historyOf(view.state);
  expect(frozen).toHaveLength(MAX_HISTORY_HUNKS);
  expect(frozen[0]?.after).toBe(String.fromCharCode(97 + 7));
});

test("an accepted prediction is frozen as a hunk at once", () => {
  const view = editor("const tier = tierOf(x);", undefined, 13);
  type(view, "", 1000);
  show(view, [{ from: 13, to: 19, text: "ramTier" }]);
  expect(tab(view)).toBe(false);
  expect(view.state.doc.toString()).toBe("const tier = ramTier(x);");
  expect(historyOf(view.state).frozen.at(-1)).toEqual({
    path: "",
    line: 0,
    before: "tierOf",
    after: "ramTier",
  });
  expect(historyOf(view.state).burst).toBeNull();
});

test("a reload-sized change is not history", () => {
  const view = editor("");
  type(view, "x".repeat(5000), 1000);
  type(view, "y", 2000);
  expect(historyOf(view.state).frozen).toEqual([]);
});
