import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Deliberate macOS glyphs in copy, each with why. */
const ALLOWED: ReadonlyMap<string, string> = new Map([
  ["features/risk/preview/fixtures.ts", "a sample finding's text, not a hint"],
]);

const GLYPH = /[⌘⌥⇧⌃]/;

/** Comments describe macOS keys freely; only code and copy count. */
const withoutComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ""))
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ""));

const root = import.meta.dir;

const files = [...new Glob("**/*.{ts,tsx}").scanSync(root)].filter(
  (f) => !/\.(test|testing)\.tsx?$/.test(f) && !ALLOWED.has(f)
);

describe("shortcut copy", () => {
  test("renderer copy shows shortcuts through chord.ts, never a typed ⌘ ⌥ ⇧ ⌃", () => {
    const found = files.flatMap((file) =>
      withoutComments(readFileSync(join(root, file), "utf8")).flatMap((line, i) =>
        GLYPH.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : []
      )
    );

    expect(found).toEqual([]);
  });

  test("every allowed file still has a glyph to allow", () => {
    for (const file of ALLOWED.keys())
      expect(GLYPH.test(readFileSync(join(root, file), "utf8"))).toBe(true);
  });
});
