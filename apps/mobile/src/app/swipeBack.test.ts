import { expect, test } from "bun:test";
import { commitsSwipeBack, startsSwipeBack } from "./swipeBack.ts";

test.each([
  ["from the edge, rightwards", 10, 20, 4, true],
  ["from mid-screen", 120, 40, 2, false],
  ["from the edge, mostly vertical", 10, 12, 30, false],
  ["from the edge, leftwards", 10, -20, 0, false],
])("a swipe back starts %s: %p", (_name, x0, dx, dy, starts) => {
  expect(startsSwipeBack(x0, dx, dy)).toBe(starts);
});

test.each([
  ["a slow drag past a third of the width", 160, 0.1, true],
  ["a slow drag short of a third", 100, 0.1, false],
  ["a quick flick, however short", 40, 0.9, true],
  ["a quick flick back to the left", -10, 0.9, false],
])("%s goes back: %p", (_name, dx, vx, goes) => {
  expect(commitsSwipeBack(dx, vx, 390)).toBe(goes);
});
