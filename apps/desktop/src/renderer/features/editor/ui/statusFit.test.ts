import { expect, test } from "bun:test";
import { middleTruncate, statusFit } from "./statusFit.ts";

// One unit per character: the helper only needs widths that grow with the text.
const chars = (text: string) => text.length;

const BRANCH = "lucas/eng-499-desktop-chrome-redesign-moonlit-midnight";

test("A branch that fits stays whole", () => {
  expect(middleTruncate(BRANCH, BRANCH.length, chars)).toBe(BRANCH);
});

test("A long branch keeps its prefix and its tail around one ellipsis, within the room", () => {
  const shown = middleTruncate(BRANCH, 30, chars);

  expect(shown.length).toBe(30);
  expect(shown).toBe("lucas/eng-499-desk…it-midnight");
});

test("Each width gets the longest prefix…tail that fits, never one that overflows", () => {
  for (let room = 2; room < BRANCH.length; room += 1)
    expect(middleTruncate(BRANCH, room, chars).length).toBe(room);
});

test("With no room for a character the branch is only the ellipsis", () => {
  expect(middleTruncate(BRANCH, 1, chars)).toBe("…");
  expect(middleTruncate(BRANCH, 0, chars)).toBe("…");
});

test("Completions drops to its glyph before the branch shrinks", () => {
  expect(statusFit({ room: 300, branch: 240, completionsLabel: 80 })).toEqual({
    completions: "label",
    branchRoom: null,
  });

  // Short by 40: Completions' label gives back 80, so the branch stays whole.
  expect(statusFit({ room: 200, branch: 240, completionsLabel: 80 })).toEqual({
    completions: "glyph",
    branchRoom: null,
  });

  // Short by 140: the label's 80 isn't enough, so the branch shrinks into what is left.
  expect(statusFit({ room: 100, branch: 240, completionsLabel: 80 })).toEqual({
    completions: "glyph",
    branchRoom: 180,
  });
});
