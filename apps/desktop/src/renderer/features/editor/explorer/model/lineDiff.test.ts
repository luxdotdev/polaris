import { describe, expect, test } from "bun:test";
import { gutterMarks, linesOf } from "./lineDiff.ts";

const lines = (text: string) => linesOf(text);

describe("gutterMarks", () => {
  test("no change, no marks", () => {
    expect(gutterMarks(lines("a\nb\nc"), lines("a\nb\nc"))).toEqual([]);
  });

  test("added, modified and deleted runs on the buffer's line numbers", () => {
    const base = lines("one\ntwo\nthree\nfour\nfive");
    const doc = lines("one\nTWO\nthree\nnew\nfour");

    expect(gutterMarks(base, doc)).toEqual([
      { kind: "modified", from: 2, to: 2 },
      { kind: "added", from: 4, to: 4 },
      { kind: "deleted", at: 6 },
    ]);
  });

  test("deleting the first lines marks above line 1", () => {
    expect(gutterMarks(lines("x\ny\nz"), lines("z"))).toEqual([{ kind: "deleted", at: 1 }]);
  });

  test("a new file is one added run", () => {
    expect(gutterMarks([], lines("a\nb"))).toEqual([{ kind: "added", from: 1, to: 2 }]);
  });

  test("CRLF and LF split alike", () => {
    expect(gutterMarks(linesOf("a\r\nb"), linesOf("a\nb"))).toEqual([]);
  });

  const lcs = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => {
    const dp = Array.from({ length: a.length + 1 }, () =>
      Array.from({ length: b.length + 1 }, () => 0)
    );

    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i]![j] =
          a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }

    return dp[a.length]![b.length]!;
  };

  test("unmarked lines are a longest common subsequence (random edits)", () => {
    let seed = 7;

    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;

      return seed % n;
    };

    for (let round = 0; round < 300; round++) {
      const base = Array.from({ length: rand(12) }, () => "abcd"[rand(4)]!);
      const doc = Array.from({ length: rand(12) }, () => "abcd"[rand(4)]!);

      const marked = gutterMarks(base, doc).reduce(
        (sum, m) => sum + (m.kind === "deleted" ? 0 : m.to - m.from + 1),
        0
      );

      expect(doc.length - marked).toBe(lcs(base, doc));
    }
  });

  test("a rewrite past the edit budget is one modified run", () => {
    const base = Array.from({ length: 3000 }, (_, i) => `a${i}`);
    const doc = Array.from({ length: 3000 }, (_, i) => `b${i}`);

    expect(gutterMarks(base, doc)).toEqual([{ kind: "modified", from: 1, to: 3000 }]);
  });
});
