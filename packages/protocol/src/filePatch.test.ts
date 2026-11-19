import { describe, expect, test } from "bun:test";
import {
  FILE_PATCH_CAP,
  FILE_PATCH_INPUT_BUDGET,
  type FilePatch,
  filePatch,
  joinFilePatches,
  patchFromUnifiedDiff,
} from "./filePatch.ts";

const NO_NEWLINE = "\\ No newline at end of file";

/** A text's lines, each with its own `\n` (a last one without keeps none). */
const linesWithEnds = (text: string): Array<string> => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/** A hunk body's lines with their ends: a line followed by the no-newline note has none. */
const bodyLines = (body: ReadonlyArray<string>) =>
  body.flatMap((line, i) =>
    line === NO_NEWLINE
      ? []
      : [{ kind: line[0], text: body[i + 1] === NO_NEWLINE ? line.slice(1) : `${line.slice(1)}\n` }]
  );

/** Where a hunk starts in the old text's lines, 0-based, from its header. */
const hunkStart = (header: string): number => {
  const [, start = "0", count] = /^@@ -(\d+)(?:,(\d+))?/.exec(header) ?? [];

  return count === "0" ? Number(start) : Number(start) - 1;
};

/** Applies a patch's hunks to `before` exactly, checking each context and removed line. */
const apply = (before: string, patch: FilePatch): string => {
  const lines = linesWithEnds(before);
  const out: Array<string> = [];
  let at = 0;

  for (const hunk of patch.diff.split(/^(?=@@)/m).filter(Boolean)) {
    const [header = "", ...body] = hunk.replace(/\n$/, "").split("\n");
    out.push(...lines.slice(at, hunkStart(header)));
    at = Math.max(at, hunkStart(header));

    for (const { kind, text } of bodyLines(body)) {
      if (kind !== "-") out.push(text);

      if (kind === "+") continue;
      expect(lines[at]).toBe(text);
      at++;
    }
  }

  return [...out, ...lines.slice(at)].join("");
};

/** A deterministic pseudo-random text and an edit of it; odd seeds end without a newline. */
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

  const end = seed % 2 === 0 ? "\n" : "";

  return { before: `${before.join("\n")}\n`, after: `${after.join("\n")}${end}` };
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
    ["a", "a\n", `@@ -1 +1 @@\n-a\n${NO_NEWLINE}\n+a\n`],
    ["a\n", "a", `@@ -1 +1 @@\n-a\n+a\n${NO_NEWLINE}\n`],
    ["x\ny", "x\nz", `@@ -1,2 +1,2 @@\n x\n-y\n${NO_NEWLINE}\n+z\n${NO_NEWLINE}\n`],
  ])(
    "a newline at the end of the file counts, as diff -u says (%j to %j)",
    (before, after, diff) => {
      expect(filePatch(before, after)).toEqual({ diff, added: 1, removed: 1, truncated: false });
    }
  );

  test.each([
    [1, 50, 10],
    [2, 300, 3],
    [3, 200, 40],
    [4, 3000, 45],
    [5, 1, 0],
  ])(
    "applying the patch gives the new text exactly (seed %d, %d lines, churn %d%%)",
    (seed, size, churn) => {
      const { before, after } = pair(seed, size, churn);
      const patch = filePatch(before, after);

      expect(patch.truncated).toBe(false);
      expect(apply(before, patch)).toBe(after);
    }
  );

  test("hunks deep in a long file keep the file's line numbers", () => {
    const before = Array.from({ length: 5000 }, (_, i) => `l${i + 1}\n`).join("");
    const patch = filePatch(before, before.replace("l4000\n", "changed\n"));

    expect(patch.diff.split("\n")[0]).toBe("@@ -3997,7 +3997,7 @@");
    expect(apply(before, patch)).toBe(before.replace("l4000\n", "changed\n"));
  });

  test("a minimal diff counts only the lines that changed", () => {
    const before = "a\nb\nc\nd\ne\n";

    expect(filePatch(before, "a\nB\nc\nd\ne\nf\n")).toMatchObject({ added: 2, removed: 1 });
  });

  test("past the cap it keeps the counts and drops the hunks", () => {
    const after = "y".repeat(FILE_PATCH_CAP);

    expect(filePatch("x\n", after)).toEqual({ diff: "", added: 1, removed: 1, truncated: true });
  });

  test("past the input budget it scans for counts without building a diff", () => {
    // Two 1 MiB texts of 524,288 one-character lines, one line changed in the middle.
    const before = Array.from({ length: 524_288 }, (_, i) => `${i % 7}\n`).join("");
    const after = `${before.slice(0, 524_288)}X${before.slice(524_289)}`;
    expect(before.length + after.length).toBeGreaterThan(FILE_PATCH_INPUT_BUDGET);
    const started = performance.now();

    const patch = filePatch(before, after);

    expect(performance.now() - started).toBeLessThan(100);
    expect(patch).toEqual({ diff: "", added: 1, removed: 1, truncated: true });
  });

  test("the worst diff under the budget stays bounded", () => {
    // Two unrelated texts just under the budget: Myers stops at 1000 edits and swaps the middle.
    const side = (tag: string) => Array.from({ length: 9000 }, (_, i) => `${tag}${i}\n`).join("");

    const [before, after] = [side("a"), side("b")];
    expect(before.length + after.length).toBeLessThan(FILE_PATCH_INPUT_BUDGET);
    const started = performance.now();

    const patch = filePatch(before, after);

    expect(performance.now() - started).toBeLessThan(250);
    expect(patch).toMatchObject({ added: 9000, removed: 9000, truncated: true });
  });
});

describe("patchFromUnifiedDiff", () => {
  test("drops file headers, keeps no-newline notes, and counts a removed `--` line", () => {
    const diff = `--- a/q.sql\n+++ b/q.sql\n@@ -1,2 +1,2 @@\n--- old comment\n+-- new comment\n select 1\n${NO_NEWLINE}\n`;

    expect(patchFromUnifiedDiff(diff)).toEqual({
      diff: `@@ -1,2 +1,2 @@\n--- old comment\n+-- new comment\n select 1\n${NO_NEWLINE}\n`,
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
