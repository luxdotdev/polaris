import { expect, test } from "bun:test";
import { BRANCH_FLOOR, HOST_FLOOR, middleTruncate, statusFit } from "./statusFit.ts";

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
  expect(statusFit({ room: 300, branch: 240, completionsLabel: 80, host: 60 })).toEqual({
    completions: "label",
    branchRoom: null,
    hostRoom: null,
  });

  // Short by 40: Completions' label gives back 80, so the branch stays whole.
  expect(statusFit({ room: 200, branch: 240, completionsLabel: 80, host: 60 })).toEqual({
    completions: "glyph",
    branchRoom: null,
    hostRoom: null,
  });

  // Short by 140: the label's 80 isn't enough, so the branch shrinks into what is left.
  expect(statusFit({ room: 100, branch: 240, completionsLabel: 80, host: 60 })).toEqual({
    completions: "glyph",
    branchRoom: 180,
    hostRoom: null,
  });
});

// A remote Host's long name, 245px wide, beside a 700px branch: the rows that broke at 1100px.
const WIDE = { branch: 700, completionsLabel: 80, host: 245 };

test("Once the branch is at its floor, the Host name gives way before the branch shrinks further", () => {
  const fit = statusFit({ ...WIDE, room: BRANCH_FLOOR - 80 - 100 });

  expect(fit).toEqual({ completions: "glyph", branchRoom: BRANCH_FLOOR, hostRoom: 145 });
});

test("With the Host name at its floor, the branch shrinks below its floor, to nothing at worst", () => {
  // Short by 120 after the glyph: the Host gives 165 (245 → 80), leaving the branch 45.
  expect(statusFit({ ...WIDE, room: -200 })).toEqual({
    completions: "glyph",
    branchRoom: 45,
    hostRoom: HOST_FLOOR,
  });
  expect(statusFit({ ...WIDE, room: -900 }).branchRoom).toBe(0);
});

test("Each item given its cap fits the row exactly while there is anything left to shrink", () => {
  for (let room = -300; room < 800; room += 7) {
    const fit = statusFit({ ...WIDE, room });
    const used = (fit.branchRoom ?? WIDE.branch) + (fit.hostRoom ?? WIDE.host) - WIDE.host;
    const available = room + (fit.completions === "glyph" ? WIDE.completionsLabel : 0);

    if (fit.branchRoom !== 0) expect(used).toBeLessThanOrEqual(available + 0.001);
  }
});

test("A short Host name is never padded out to the floor", () => {
  expect(statusFit({ ...WIDE, host: 40, room: -400 }).hostRoom).toBeNull();
});
