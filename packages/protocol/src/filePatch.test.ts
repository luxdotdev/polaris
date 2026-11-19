import { describe, expect, test } from "bun:test";
import {
  FILE_PATCH_CAP,
  type FilePatch,
  filePatch,
  joinFilePatches,
  patchFromUnifiedDiff,
} from "./filePatch.ts";

/** Where a hunk starts in the old text's lines, 0-based, from its header. */
const hunkStart = (header: string): number => {
  const [, start = "0", count] = /^@@ -(\d+)(?:,(\d+))?/.exec(header) ?? [];

  return count === "0" ? Number(start) : Number(start) - 1;
};

/** Applies a patch's hunks to `before`, checking each context and removed line matches. */
const apply = (before: string, patch: FilePatch): string => {
  const lines = before === "" ? [] : before.replace(/\n$/, "").split("\n");
  const out: Array<string> = [];
  let at = 0;

  for (const hunk of patch.diff.split(/^(?=@@)/m).filter(Boolean)) {
    const [header = "", ...body] = hunk.replace(/\n$/, "").split("\n");
    const start = hunkStart(header);

    while (at < start) out.push(lines[at++]!);

    for (const line of body) {
      const [kind, text] = [line[0], line.slice(1)];

      if (kind !== "-") out.push(text);

      if (kind === "+") continue;
      expect(lines[at]).toBe(text);
      at++;
    }
  }

  out.push(...lines.slice(at));

  return out.length === 0 ? "" : `${out.join("\n")}\n`;
};

/** A deterministic pseudo-random text and an edit of it. */
const pair = (seed: number, size: number, churn: number) => {
  let s = seed;

  const next = (n: number) => {
    s = (s * 1103515245 + 12345) % 2 ** 31;

    return s % n;
  };

  const before = Array.from({ length: size }, () => `line ${next(20)}`);

  const after = before.flatMap((line) => {
    const roll = next(100);

    if (roll < churn) return [];

    return roll < 2 * churn ? [line, `new ${next(20)}`] : [line];
  });

  return { before: `${before.join("\n")}\n`, after: `${after.join("\n")}\n` };
};

describe("filePatch", () => {
  test("writes the same hunks as diff -u", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}\n`).join("");
    const after = before.replace("line 3\n", "line three\n").replace("line 18\n", "") + "tail\n";

    expect(filePatch(before, after)).toEqual({
      diff:
        "@@ -1,6 +1,6 @@\n line 1\n line 2\n-line 3\n+line three\n line 4\n line 5\n line 6\n" +
        "@@ -15,6 +15,6 @@\n line 15\n line 16\n line 17\n-line 18\n line 19\n line 20\n+tail\n",
      added: 2,
      removed: 2,
      truncated: false,
    });
  });

  test.each([
    [1, 50, 10],
    [2, 300, 3],
    [3, 200, 40],
    [4, 3000, 45],
  ])(
    "applying the patch gives the new text (seed %d, %d lines, churn %d%%)",
    (seed, size, churn) => {
      const { before, after } = pair(seed, size, churn);
      const patch = filePatch(before, after);

      expect(patch.truncated).toBe(false);
      expect(apply(before, patch)).toBe(after);
    }
  );

  test("a minimal diff counts only the lines that changed", () => {
    const before = "a\nb\nc\nd\ne\n";

    expect(filePatch(before, "a\nB\nc\nd\ne\nf\n")).toMatchObject({ added: 2, removed: 1 });
  });

  test("past the cap it keeps the counts and drops the hunks", () => {
    const after = "y".repeat(FILE_PATCH_CAP);

    expect(filePatch("x\n", after)).toEqual({ diff: "", added: 1, removed: 1, truncated: true });
  });
});

describe("patchFromUnifiedDiff", () => {
  test("drops file headers and no-newline markers, and counts a removed `--` line", () => {
    const diff =
      "--- a/q.sql\n+++ b/q.sql\n@@ -1,2 +1,2 @@\n--- old comment\n+-- new comment\n select 1\n\\ No newline at end of file\n";

    expect(patchFromUnifiedDiff(diff)).toEqual({
      diff: "@@ -1,2 +1,2 @@\n--- old comment\n+-- new comment\n select 1\n",
      added: 1,
      removed: 1,
      truncated: false,
    });
  });
});

describe("joinFilePatches", () => {
  test("a truncated part truncates the whole, keeping every count", () => {
    const small = filePatch("a\n", "b\n");
    const big = filePatch("", "z".repeat(FILE_PATCH_CAP));

    expect(joinFilePatches([small, big])).toEqual({
      diff: "",
      added: 2,
      removed: 1,
      truncated: true,
    });
  });
});
