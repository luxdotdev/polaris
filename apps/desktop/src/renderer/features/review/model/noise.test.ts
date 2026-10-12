import { describe, expect, test } from "bun:test";
import { fileListRows } from "./fileList.ts";
import type { ReviewFile, ReviewSection } from "./layout.ts";
import { hideableTests, isHiddenPath, noiseOf, withoutFiles } from "./noise.ts";
import type { PatchFile } from "./patch.ts";

const patch = (path: string, generated: boolean | null = null): PatchFile => ({
  path,
  oldPath: null,
  status: "modified",
  offset: 0,
  length: 1,
  additions: 1,
  deletions: 0,
  binary: false,
  generated,
});

const file = (section: string, path: string): ReviewFile => ({
  key: `${section}:${path}`,
  index: 0,
  section,
  file: patch(path),
  fingerprint: "x",
  ...noiseOf(patch(path)),
});

const sections: ReadonlyArray<ReviewSection> = [
  { id: "2", divider: null, files: [file("2", "src/a.ts"), file("2", "src/a.test.ts")] },
  { id: "1", divider: null, files: [file("1", "e2e/flow.ts")] },
];

describe("noise", () => {
  test("the Daemon's verdict wins; older Daemons fall back to the patterns; generated isn't a test", () => {
    expect(noiseOf(patch("src/schema.ts", true))).toEqual({ generated: true, test: false });
    expect(noiseOf(patch("bun.lock", false))).toEqual({ generated: false, test: false });
    expect(noiseOf(patch("bun.lock"))).toEqual({ generated: true, test: false });
    expect(noiseOf(patch("src/a.test.ts"))).toEqual({ generated: false, test: true });
  });

  test("hiding tests keeps a test with a Finding, and drops sections left empty", () => {
    const hidden = hideableTests(
      sections.flatMap((s) => s.files),
      new Map([["e2e/flow.ts", "medium"]])
    );

    expect([...hidden]).toEqual(["2:src/a.test.ts"]);
    expect(withoutFiles(sections, hidden).map((s) => s.files.map((f) => f.key))).toEqual([
      ["2:src/a.ts"],
      ["1:e2e/flow.ts"],
    ]);
    expect(withoutFiles(sections, new Set(["1:e2e/flow.ts"])).map((s) => s.id)).toEqual(["2"]);
    expect(isHiddenPath(sections, hidden, "src/a.test.ts")).toBe(true);
    expect(isHiddenPath(sections, hidden, "src/a.ts")).toBe(false);
  });

  test("the tests row reads hidden or shown, last in the list", () => {
    const files = sections[0]?.files ?? [];

    const label = (hidden: boolean) =>
      fileListRows(files, () => false, new Set(), { count: 11, hidden }).at(-1);

    expect(label(true)).toEqual({ kind: "fold", fold: "tests", count: 11, open: false });
    expect(label(false)).toMatchObject({ fold: "tests", open: true });
    expect(fileListRows(files, () => false, new Set(), { count: 0, hidden: true })).toHaveLength(2);
  });
});
