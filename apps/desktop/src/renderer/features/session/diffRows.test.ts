import { describe, expect, test } from "bun:test";
import { parseUnifiedDiff } from "./model/diff.ts";
import { diffRows, lineColumns, widestColumns } from "./diffRows.ts";

describe("lineColumns", () => {
  test.each([
    ["plain ASCII is one cell a character", "const a = 1;", 12],
    ["a leading tab reaches the first stop", "\treturn", 14],
    ["a tab mid-line reaches the next stop", "ab\tc", 9],
    ["CJK takes two cells", "名前", 4],
    ["an emoji takes two cells, not its two UTF-16 units", "ok 🚀", 5],
  ])("%s", (_name, text, columns) => {
    expect(lineColumns(text)).toBe(columns);
  });
});

const PATCH = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,2 @@
 short
-${"x".repeat(300)}
+y
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1 +1 @@
-${"z".repeat(40)}
+${"w".repeat(120)}
`;

describe("widestColumns", () => {
  test("the widest line of any file sets how far the list scrolls", () => {
    expect(widestColumns(diffRows(parseUnifiedDiff(PATCH), new Set()))).toBe(300);
  });

  test("a folded file's lines no longer widen the list", () => {
    expect(widestColumns(diffRows(parseUnifiedDiff(PATCH), new Set(["a.ts"])))).toBe(120);
  });
});
