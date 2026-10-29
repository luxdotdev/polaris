import { describe, expect, test } from "bun:test";
import { detentHeights, dragHeight, rubberBand, settle } from "./detents.ts";

// An iPhone 16 Pro's window: 852pt tall with a 59pt status bar.
const room = { height: 852, topInset: 59 };

const [medium, large] = detentHeights(["medium", "large"], room);

const heights = [medium ?? 0, large ?? 0];

describe("detentHeights", () => {
  test("medium is MX-H's 540pt and large stops 10pt under the status bar", () => {
    expect(heights).toEqual([540, 783]);
  });

  test("orders the detents, folds duplicates and caps heights at large", () => {
    expect(detentHeights([2000, "large", 300, 300, "medium"], room)).toEqual([300, 540, 783]);
  });

  test("a keyboard that shrinks the room pulls medium down to fit", () => {
    expect(detentHeights(["medium", "large"], { height: 500, topInset: 59 })).toEqual([317, 431]);
  });

  test("drops detents with no height", () => {
    expect(detentHeights([0, -20, "medium"], room)).toEqual([540]);
  });
});

describe("settle", () => {
  test.each([
    ["held near medium on the way down from large", 600, 0, { kind: "detent", index: 0 }],
    ["held nearer large than medium", 700, 0, { kind: "detent", index: 1 }],
    ["a slow drag that ends nearer medium than closed", 300, 0, { kind: "detent", index: 0 }],
    ["a slow drag most of the way down", 200, 0, { kind: "dismiss" }],
    ["a gentle push down that coasts past half", 300, 400, { kind: "dismiss" }],
    ["a flick up from medium", 540, -800, { kind: "detent", index: 1 }],
    ["a flick up from large", 783, -1200, { kind: "detent", index: 1 }],
    ["a flick down from large stops at medium", 783, 900, { kind: "detent", index: 0 }],
    ["a flick down from medium", 540, 900, { kind: "dismiss" }],
    ["a flick down while rubber-banded past large", 820, 900, { kind: "detent", index: 0 }],
  ] as const)("%s", (_name, height, velocity, expected) => {
    expect(settle(heights, height, velocity)).toEqual(expected);
  });

  test("a sheet that can't be dismissed rests at its lowest detent instead", () => {
    expect(settle(heights, 540, 900, false)).toEqual({ kind: "detent", index: 0 });
    expect(settle(heights, 40, 0, false)).toEqual({ kind: "detent", index: 0 });
  });

  test("a sheet with no detents dismisses", () => {
    expect(settle([], 300, 0)).toEqual({ kind: "dismiss" });
  });
});

describe("rubber band", () => {
  test("gives ground more slowly the further it is pulled, never as far as the finger", () => {
    const pulls = [20, 100, 400, 4000];
    const shown = pulls.map((overshoot) => rubberBand(overshoot, 852));

    const give = (i: number) =>
      ((shown[i + 1] ?? 0) - (shown[i] ?? 0)) / ((pulls[i + 1] ?? 0) - (pulls[i] ?? 0));

    shown.forEach((height, i) => expect(height).toBeLessThan(pulls[i] ?? 0));
    expect(shown[3]).toBeLessThan(852);
    expect(give(0)).toBeGreaterThan(give(1));
    expect(give(1)).toBeGreaterThan(give(2));
  });

  test("a drag below the tallest detent follows the finger", () => {
    expect(dragHeight(612, 783, room)).toBe(612);
  });

  test("a drag above the tallest detent resists", () => {
    const shown = dragHeight(883, 783, room);

    expect(shown).toBeGreaterThan(783);
    expect(shown).toBeLessThan(883);
  });
});
