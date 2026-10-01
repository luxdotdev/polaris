import { describe, expect, test } from "bun:test";
import { parsePatchFiles } from "@pierre/diffs";
import { quoteLines } from "./quote.ts";

const PATCH = `diff --git a/a.ts b/a.ts
index 1111111..2222222 100644
--- a/a.ts
+++ b/a.ts
@@ -10,4 +10,5 @@ function f() {
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;
 return a;
`;

const file = () => {
  const parsed = parsePatchFiles(PATCH)[0]?.files[0];

  if (parsed === undefined) throw new Error("no file parsed");

  return parsed;
};

describe("quoting selected lines", () => {
  test("new side, across context and additions", () => {
    expect(quoteLines(file(), "new", 11, 12)).toBe("const b = 3;\nconst c = 4;");
    expect(quoteLines(file(), "new", 10, 10)).toBe("const a = 1;");
  });

  test("old side", () => {
    expect(quoteLines(file(), "old", 11, 11)).toBe("const b = 2;");
  });

  test("lines outside the hunks are skipped", () => {
    expect(quoteLines(file(), "new", 1, 2)).toBe("");
  });
});
