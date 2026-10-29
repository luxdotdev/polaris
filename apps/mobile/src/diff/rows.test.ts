import { describe, expect, test } from "bun:test";
import { parsePatch } from "../review/patch.ts";
import { finding } from "../review/review.testing.ts";
import { fileRows, noLinesNote, type ScreenRow } from "./rows.ts";

const patch = [
  "diff --git a/up.ts b/up.ts",
  "--- a/up.ts",
  "+++ b/up.ts",
  "@@ -1,3 +1,4 @@",
  " a();",
  "-b(x);",
  "+b(x, y);",
  "+c();",
  " d();",
  "",
].join("\n");

const file = parsePatch(patch)[0];

if (file === undefined) throw new Error("the fixture has one file");

const rowSummary = (rows: ReadonlyArray<ScreenRow>) =>
  rows.map((row) => {
    if (row.kind === "finding") return `finding ${row.finding.id}`;

    if (row.kind === "hunk") return "hunk";

    if (row.kind === "line") return `${row.line.line} ${row.mark ?? "-"}`;

    return `${row.pair.old?.oldNumber ?? "_"}|${row.pair.new?.newNumber ?? "_"} ${row.mark ?? "-"}`;
  });

describe("a file's screen rows", () => {
  const flagged = finding("f1", "high", { path: "up.ts", line: 2 });
  const missing = finding("f2", "low", { path: "up.ts", line: 90 });
  const elsewhere = finding("f3", "critical", { path: "other.ts", line: 2 });

  test("unified: a finding sits under the line it ends on, one it can't place goes first", () => {
    expect(rowSummary(fileRows(file, [flagged, missing, elsewhere], "unified"))).toEqual([
      "finding f2",
      "hunk",
      "context -",
      "remove -",
      "add high",
      "finding f1",
      "add -",
      "context -",
    ]);
  });

  test("split: the flagged pair carries the mark and the card follows the pair once", () => {
    expect(rowSummary(fileRows(file, [flagged], "split"))).toEqual([
      "hunk",
      "1|1 -",
      "2|2 high",
      "finding f1",
      "_|3 -",
      "3|4 -",
    ]);
  });
});

describe("a file with no lines", () => {
  test("says it was renamed, or why nothing shows", () => {
    const [renamed, binary] = parsePatch(
      [
        "diff --git a/README.md b/docs/README.md",
        "similarity index 100%",
        "rename from README.md",
        "rename to docs/README.md",
        "diff --git a/logo.png b/logo.png",
        "Binary files a/logo.png and b/logo.png differ",
        "",
      ].join("\n")
    );

    expect([renamed, binary].map((f) => (f === undefined ? null : noLinesNote(f)))).toEqual([
      "Renamed from README.md. Its contents didn't change.",
      "No line changes to show. It may be a binary file.",
    ]);
    expect(noLinesNote(file)).toBeNull();
  });
});
