import { expect, test } from "bun:test";
import { parseAddedLines } from "./addedLines.ts";

const diff = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,0 +2,2 @@",
  "+++counter;",
  "+const added = true;",
  "@@ -9 +10 @@",
  "-old line",
  "+new line",
  "\\ No newline at end of file",
  "diff --git a/gone.ts b/gone.ts",
  "deleted file mode 100644",
  "--- a/gone.ts",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-was here",
  "diff --git a/logo.png b/logo.png",
  "Binary files a/logo.png and b/logo.png differ",
  'diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251.ts"',
  "new file mode 100644",
  "--- /dev/null",
  '+++ "b/caf\\303\\251.ts"',
  "@@ -0,0 +1 @@",
  "+export const café = 1;",
  "",
].join("\n");

test("each added line keeps its path, and nothing else counts as added", () => {
  expect(parseAddedLines(diff)).toEqual([
    { path: "src/a.ts", text: "++counter;" },
    { path: "src/a.ts", text: "const added = true;" },
    { path: "src/a.ts", text: "new line" },
    { path: "café.ts", text: "export const café = 1;" },
  ]);
});
