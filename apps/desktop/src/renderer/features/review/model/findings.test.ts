import { describe, expect, test } from "bun:test";
import {
  type FindingInfo,
  findingsIn,
  isDimmed,
  lineMarks,
  riskMark,
  severityByPath,
} from "./findings.ts";
import type { ReviewFile } from "./layout.ts";

const finding = (id: string, patch: Partial<FindingInfo>): FindingInfo => ({
  id,
  path: "a.ts",
  lines: { start: 4, end: 5, side: "new" },
  severity: "medium",
  confidence: 0.8,
  title: id,
  reason: "",
  status: "open",
  ...patch,
});

const file = (path: string, index: number): ReviewFile => ({
  key: `s:${path}:${index}`,
  index,
  section: "s",
  fingerprint: "x",
  file: {
    path,
    oldPath: null,
    status: "modified",
    offset: 0,
    length: 0,
    additions: 1,
    deletions: 0,
    binary: false,
  },
});

const FINDINGS = [
  finding("open-medium", {}),
  finding("dismissed-high", { severity: "high", status: "dismissed" }),
  finding("dismissed-critical", { severity: "critical", status: "dismissed", path: "b.ts" }),
  finding("low", { severity: "low", confidence: 0.3 }),
];

describe("findings in the diff", () => {
  test("a resolved Critical (fixed) leaves no mark", () => {
    expect(
      severityByPath([finding("fixed", { severity: "critical", status: "resolved", path: "c.ts" })])
    ).toEqual(new Map());
  });

  test("dismissed findings drop out, except a Critical one", () => {
    expect(severityByPath(FINDINGS)).toEqual(
      new Map([
        ["a.ts", "medium"],
        ["b.ts", "critical"],
      ])
    );
  });

  test("marks every file with the path, in each Turn it appears", () => {
    const marks = lineMarks(FINDINGS, [file("a.ts", 0), file("a.ts", 3), file("c.ts", 4)]);

    expect(marks.map((m) => [m.item, m.severity])).toEqual([
      ["f0", "medium"],
      ["f0", "low"],
      ["f3", "medium"],
      ["f3", "low"],
    ]);
  });

  test("reason rows, most severe first; low confidence dims all but Critical", () => {
    expect(findingsIn(FINDINGS, "a.ts").map((f) => f.id)).toEqual(["open-medium", "low"]);
    expect(isDimmed(finding("x", { severity: "low", confidence: 0.3 }))).toBe(true);
    expect(isDimmed(finding("x", { severity: "critical", confidence: 0.1 }))).toBe(false);
  });
});

test("a queue row shows the highest shown Severity and its count", () => {
  expect(riskMark(FINDINGS)).toEqual({ severity: "critical", count: 1 });
  expect(riskMark(FINDINGS.slice(0, 2))).toEqual({ severity: "medium", count: 1 });
  expect(riskMark([finding("a", {}), finding("b", {})])).toEqual({ severity: "medium", count: 2 });
  expect(riskMark([])).toBeNull();
});
