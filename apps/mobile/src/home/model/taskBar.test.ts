import { expect, test } from "bun:test";
import { taskBar } from "../../constellation/model.ts";
import { progressLine, progressOf, sevenSegments } from "./taskBar.ts";

const draw = (done: number, working: number, total: number) =>
  sevenSegments({ done, working, total })
    .map((segment) => ({ done: "#", working: "+", rest: "." })[segment])
    .join("");

test.each([
  [3, 1, 7, "###+..."],
  [0, 0, 7, "......."],
  [7, 0, 7, "#######"],
  [10, 2, 20, "####+.."],
  [1, 1, 40, "+......"],
  [0, 0, 0, "......."],
])("%i done, %i working of %i draws %s", (done, working, total, bar) => {
  expect(draw(done, working, total)).toBe(bar);
});

test("the line counts tasks, with the lead", () => {
  expect(progressLine({ done: 3, working: 1, total: 7 })).toBe("3 of 7 tasks · lead");
  expect(progressLine(null)).toBe("lead");
});

test("a constellation's progress counts its working tasks, and leaves ended ones out", () => {
  const bar = taskBar(
    (["done", "working", "review", "working", "ended", "done", "failed"] as const).map((tone) => ({
      tone,
      harness: null,
    }))
  );

  expect(progressOf(bar)).toEqual({ done: 2, working: 2, total: 6 });
  expect(progressLine(progressOf(bar))).toBe("2 of 6 tasks · lead");
});
