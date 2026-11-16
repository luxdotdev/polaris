import { expect, test } from "bun:test";
import { touchesLines } from "./commentOutdating.ts";

// A Comment on lines 10-12.
test.each([
  ["a change inside", { start: 11, count: 1 }, true],
  ["a change overlapping its first line", { start: 8, count: 3 }, true],
  ["a change overlapping its last line", { start: 12, count: 4 }, true],
  ["a change just before", { start: 7, count: 3 }, false],
  ["a change just after", { start: 13, count: 2 }, false],
  ["an insertion between its lines", { start: 10, count: 0 }, true],
  ["an insertion right after its last line", { start: 12, count: 0 }, false],
  ["an insertion right before its first line", { start: 9, count: 0 }, false],
])("%s: %p", (_, span, touched) => {
  expect(touchesLines([span], 10, 12)).toBe(touched);
});
