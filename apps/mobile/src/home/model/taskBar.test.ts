import { expect, test } from "bun:test";
import { progressLine, sevenSegments } from "./taskBar.ts";

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
