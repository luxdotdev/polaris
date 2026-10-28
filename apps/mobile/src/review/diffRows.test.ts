import { describe, expect, test } from "bun:test";
import { flaggedCode } from "./actions.ts";
import {
  defaultOpen,
  type DiffFileInput,
  type DiffRow,
  diffRows,
  fileLines,
  type LineRow,
  orderFiles,
} from "./diffRows.ts";
import { finding } from "./review.testing.ts";
import { parsePatch } from "./patch.ts";

const patch = [
  "diff --git a/serve.ts b/serve.ts",
  "index 1111111..2222222 100644",
  "--- a/serve.ts",
  "+++ b/serve.ts",
  "@@ -10,3 +10,4 @@ export const serve",
  ' import { publish } from "./artifact";',
  "-const URL = process.env.ARTIFACT_URL;",
  '+const URL = "https://example.com";',
  '+const TOKEN = "sk-ant-api03-secret";',
  " publish(URL);",
  "diff --git a/index.html b/index.html",
  "index 3333333..4444444 100644",
  "--- a/index.html",
  "+++ b/index.html",
  "@@ -1,2 +1,2 @@",
  "-<title>Old</title>",
  "+<title>New</title>",
  " <body>",
  "",
].join("\n");

const files: ReadonlyArray<DiffFileInput> = parsePatch(patch).map((diff) => ({
  diff,
  added: 0,
  removed: 0,
}));

const allOpen = new Set(["serve.ts", "index.html"]);

const lines = (rows: ReadonlyArray<DiffRow>) => rows.filter((r): r is LineRow => r.kind === "line");

describe("diff rows", () => {
  test("number unified lines on both sides, deletions before additions", () => {
    const serve = lines(diffRows(files, [], allOpen)).filter((r) => r.key.includes("serve.ts"));

    expect(serve.map((r) => [r.line, r.oldNumber, r.newNumber])).toEqual([
      ["context", 10, 10],
      ["remove", 11, null],
      ["add", null, 11],
      ["add", null, 12],
      ["context", 12, 13],
    ]);
  });

  test("a finding sits under the line it flags, and marks the lines it covers", () => {
    const rows = diffRows(files, [finding("key", "critical", { line: 12 })], allOpen);
    const at = rows.findIndex((r) => r.kind === "finding");

    expect(rows[at - 1]).toMatchObject({ kind: "line", newNumber: 12, mark: "critical" });
    expect(lines(rows).filter((r) => r.mark !== null)).toHaveLength(1);
  });

  test("an old-side finding anchors on the removed line", () => {
    const rows = diffRows(files, [finding("old", "high", { line: 11, side: "old" })], allOpen);
    const at = rows.findIndex((r) => r.kind === "finding");

    expect(rows[at - 1]).toMatchObject({ line: "remove", oldNumber: 11 });
  });

  test("closing a file keeps its Critical card and drops the rest", () => {
    const rows = diffRows(
      files,
      [finding("c", "critical", { line: 12 }), finding("h", "high", { line: 11 })],
      new Set()
    );

    const serve = rows.filter((r) => r.key.includes("serve.ts") || r.kind === "finding");

    expect(serve.map((r) => r.kind)).toEqual(["file", "finding"]);
    expect(rows.some((r) => r.kind === "finding" && r.finding.id === "h")).toBe(false);
  });

  test("a finding on a line the diff doesn't show stays, under the file header", () => {
    const rows = diffRows(files, [finding("far", "medium", { line: 400 })], allOpen);

    expect(rows.slice(0, 2).map((r) => r.kind)).toEqual(["file", "finding"]);
  });

  test("files with a Critical open first, and Risk order ranks them first", () => {
    const findings = [finding("c", "critical", { path: "index.html" })];

    expect([...defaultOpen(files, findings)]).toEqual(["index.html"]);
    expect(orderFiles(files, findings, "risk").map((f) => f.diff.name)).toEqual([
      "index.html",
      "serve.ts",
    ]);
    expect(orderFiles(files, findings, "path").map((f) => f.diff.name)).toEqual([
      "serve.ts",
      "index.html",
    ]);
  });

  test("Ask to fix quotes the flagged code from the diff, even from a closed file", () => {
    const rows = [...fileLines(files, "serve.ts"), ...fileLines(files, "index.html")];

    expect(flaggedCode(finding("k", "critical", { line: 12 }), rows)).toBe(
      'const TOKEN = "sk-ant-api03-secret";'
    );
    expect(flaggedCode(finding("o", "high", { line: 11, side: "old" }), rows)).toContain(
      "process.env.ARTIFACT_URL"
    );
    // Line 1 exists in both files; only the finding's own file is quoted.
    expect(flaggedCode(finding("t", "low", { line: 1, path: "index.html" }), rows)).toBe(
      "<title>New</title>"
    );
  });
});
