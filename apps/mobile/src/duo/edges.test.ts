import { expect, test } from "bun:test";
import { edgeInsets } from "./edges.ts";

/** The iPhone Duo's cover window as the simulator reports it: the status cutout insets the right. */
const WINDOW = { width: 466, height: 678 };

const INSETS = { top: 0, right: 84, bottom: 34, left: 0 };

test("side by side, only the second half keeps clear of the right cutout", () => {
  const first = edgeInsets({ x: 0, y: 0, width: 233, height: 678 }, WINDOW, INSETS);
  const second = edgeInsets({ x: 233, y: 0, width: 233, height: 678 }, WINDOW, INSETS);

  expect([first, second]).toEqual([
    { top: 0, right: 0, bottom: 34, left: 0 },
    { top: 0, right: 84, bottom: 34, left: 0 },
  ]);
});

test("stacked, both halves keep clear of the right; only the lower one of the bottom", () => {
  const top = edgeInsets({ x: 0, y: 0, width: 466, height: 339 }, WINDOW, INSETS);
  const bottom = edgeInsets({ x: 0, y: 339, width: 466, height: 339 }, WINDOW, INSETS);

  expect([top.right, top.bottom, bottom.right, bottom.bottom]).toEqual([84, 0, 84, 34]);
});
