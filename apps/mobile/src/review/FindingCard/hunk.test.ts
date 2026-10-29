import { describe, expect, test } from "bun:test";
import type { DiffFileInput } from "../diffRows.ts";
import { parsePatch } from "../patch.ts";
import { finding } from "../review.testing.ts";
import { findingHunk } from "./hunk.ts";

const patch = [
  "diff --git a/serve.ts b/serve.ts",
  "index 1111111..2222222 100644",
  "--- a/serve.ts",
  "+++ b/serve.ts",
  "@@ -2,3 +2,3 @@",
  ' import { publish } from "./artifact";',
  "-const KEY = process.env.KEY;",
  '+const KEY = "sk-ant";',
  " publish(KEY);",
  "@@ -40,2 +40,3 @@ export async function upload",
  " const a = 1;",
  "+const b = 2;",
  " const c = 3;",
  "",
].join("\n");

const files: ReadonlyArray<DiffFileInput> = parsePatch(patch).map((diff) => ({
  diff,
  added: 0,
  removed: 0,
}));

const header = (f: ReturnType<typeof findingHunk>) => f?.hunk.additionStart ?? null;

describe("a finding's inline hunk", () => {
  test("is the hunk covering its line on its side", () => {
    expect(header(findingHunk(files, finding("a", "critical", { line: 3 })))).toBe(2);
    expect(header(findingHunk(files, finding("b", "high", { line: 41 })))).toBe(40);
  });

  test("an old-side finding matches on the deleted lines' numbers", () => {
    expect(header(findingHunk(files, finding("a", "high", { line: 3, side: "old" })))).toBe(2);
  });

  test("is null for a line no hunk covers or a path the diff lacks", () => {
    expect(findingHunk(files, finding("a", "low", { line: 20 }))).toBeNull();
    expect(findingHunk(files, finding("a", "low", { path: "gone.ts" }))).toBeNull();
  });
});
