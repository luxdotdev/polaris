import { describe, expect, test } from "bun:test";
import { numbering, shownNumber } from "./numbers.ts";

describe("numbering (Paper E2)", () => {
  // Line 17 becomes two lines: 17 and 18 are the added ones, old 18 shows 19.
  const numbers = numbering([{ line: 17, removed: ["old"], added: ["a", "b"] }]);

  test("added lines take the new numbers", () => {
    expect(numbers.added).toEqual([{ after: 17, first: 17, count: 2 }]);
  });

  test("the removed line has none; lines above keep theirs; lines below move", () => {
    expect(shownNumber(numbers, 17)).toBeNull();
    expect(shownNumber(numbers, 16)).toBe(16);
    expect(shownNumber(numbers, 18)).toBe(19);
    expect(shownNumber(numbers, 30)).toBe(31);
  });

  test("an insertion after a line and a deletion further down", () => {
    const two = numbering([
      { line: 3, removed: [], added: ["x"] },
      { line: 10, removed: ["a", "b"], added: [] },
    ]);

    expect(two.added).toEqual([{ after: 3, first: 4, count: 1 }]);
    expect(shownNumber(two, 3)).toBe(3);
    expect(shownNumber(two, 4)).toBe(5);
    expect(shownNumber(two, 10)).toBeNull();
    expect(shownNumber(two, 12)).toBe(11);
  });

  test("an insertion at the top", () => {
    expect(numbering([{ line: 0, removed: [], added: ["x"] }]).added).toEqual([
      { after: 0, first: 1, count: 1 },
    ]);
  });
});
