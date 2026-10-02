import { describe, expect, test } from "bun:test";
import { charIndexOfByte, groupHits, matchIn, resultsLabel } from "./searchModel.ts";

const plain = { pattern: "sleep", regex: false, caseSensitive: false };

describe("charIndexOfByte", () => {
  test("ASCII, accents and astral characters", () => {
    expect(charIndexOfByte("abc", 2)).toBe(2);
    expect(charIndexOfByte("éa", 2)).toBe(1);
    expect(charIndexOfByte("😀a", 4)).toBe(2);
  });
});

describe("matchIn", () => {
  test("plain text is literal, regex is a regex, case as asked", () => {
    expect(matchIn("a.b axb", { pattern: ".", regex: false, caseSensitive: false }, 0)).toEqual({
      from: 1,
      to: 2,
    });
    expect(matchIn("await Sleep(1)", { ...plain, caseSensitive: true }, 0)).toBeNull();
    expect(matchIn("await Sleep(1)", plain, 0)).toEqual({ from: 6, to: 11 });
    expect(matchIn("x = 12", { pattern: "\\d+", regex: true, caseSensitive: false }, 0)).toEqual({
      from: 4,
      to: 6,
    });
  });

  test("an invalid regex is no match, not a crash", () => {
    expect(matchIn("a", { pattern: "(", regex: true, caseSensitive: false }, 0)).toBeNull();
  });
});

describe("groupHits", () => {
  test("by file in arrival order, rows by line, columns in UTF-16", () => {
    const files = groupHits(
      [
        { path: "/r/b.ts", line: 9, column: 3, text: "  sleep()" },
        { path: "/r/a.ts", line: 4, column: 4, text: "é sleep" },
        { path: "/r/b.ts", line: 2, column: 1, text: "sleep" },
      ],
      plain,
      (p) => p.replace("/r/", "")
    );

    expect(files.map((f) => f.path)).toEqual(["b.ts", "a.ts"]);
    expect(files[0]?.rows.map((r) => r.line)).toEqual([2, 9]);
    expect(files[1]?.rows[0]).toMatchObject({ column: 3, match: { from: 2, to: 7 } });
    expect(resultsLabel(files, false)).toBe("3 results in 2 files");
  });
});
