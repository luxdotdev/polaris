import { describe, expect, test } from "bun:test";
import { LineRange } from "@polaris/protocol";
import { Effect, Result } from "effect";
import { parseDiff, inDiff } from "./diff.ts";
import {
  parseReviewerReply,
  type ReadLines,
  type ReviewerFindingOutput,
  toRiskFindings,
} from "./output.ts";

const PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1..2 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -10,3 +10,4 @@ export const a = 1;",
  " const b = 2;",
  "-const c = 3;",
  "+const c = 4;",
  "+const d = c * 2;",
  " const e = 5;",
  "diff --git a/old.ts b/old.ts",
  "deleted file mode 100644",
  "--- a/old.ts",
  "+++ /dev/null",
  "@@ -1,2 +0,0 @@",
  "-gone",
  "-too",
].join("\n");

const diff = parseDiff(PATCH);

const finding = (overrides: Partial<ReviewerFindingOutput> = {}): ReviewerFindingOutput => ({
  path: "src/a.ts",
  startLine: 11,
  endLine: 12,
  side: "new",
  severity: "high",
  confidence: 0.8,
  title: "Doubles the wrong value",
  reason: "d should use the new c.",
  suggestion: null,
  ...overrides,
});

const reply = (findings: ReadonlyArray<unknown>) =>
  `I looked.\n\n\`\`\`json\n${JSON.stringify({ findings, revised: [], withdrawn: [], answer: null })}\n\`\`\``;

const file =
  (shift: number): ReadLines =>
  (path, side) =>
    Effect.succeed(
      path === "src/a.ts" && side === "new"
        ? [
            ...Array.from({ length: 9 + shift }, () => "// filler"),
            "const b = 2;",
            "const c = 4;",
            "const d = c * 2;",
            "const e = 5;",
          ]
        : null
    );

describe("the diff", () => {
  test("splits files and reads hunk ranges on both sides", () => {
    expect(diff.files.map((f) => f.path)).toEqual(["src/a.ts", "old.ts"]);
    expect(diff.files[0]?.hunks).toEqual([
      { oldStart: 10, oldLines: 3, newStart: 10, newLines: 4 },
    ]);
  });

  test("a range is in the diff when it overlaps a hunk on its side", () => {
    const at = (start: number, end: number, side: "new" | "old") =>
      LineRange.make({ start, end, side });

    expect(inDiff(diff, "src/a.ts", at(13, 20, "new"))).toBe(true);
    expect(inDiff(diff, "src/a.ts", at(14, 20, "new"))).toBe(false);
    expect(inDiff(diff, "old.ts", at(1, 1, "old"))).toBe(true);
    expect(inDiff(diff, "old.ts", at(1, 1, "new"))).toBe(false);
    expect(inDiff(diff, "missing.ts", at(1, 1, "new"))).toBe(false);
  });
});

describe("the Reviewer's reply", () => {
  test("decodes the last fenced JSON block", () => {
    const decoded = parseReviewerReply(`\`\`\`json\n{}\n\`\`\`\n${reply([finding()])}`);

    expect(decoded).toEqual(
      Result.succeed({ findings: [finding()], revised: [], withdrawn: [], answer: null })
    );
  });

  test("finds the document after an answer that quotes code", () => {
    const output = {
      findings: [],
      revised: [],
      withdrawn: [],
      answer: "Line 42:\n\n```ts\nx();\n```",
    };

    const text = `Line 42 is:\n\n\`\`\`ts\nx();\n\`\`\`\n\n\`\`\`json\n${JSON.stringify(output)}\n\`\`\``;

    expect(parseReviewerReply(text)).toEqual(Result.succeed(output));
  });

  test("refuses prose, bad JSON and schema violations with a reason", () => {
    const refused = (text: string, reason: string) =>
      expect(
        Result.match(parseReviewerReply(text), { onSuccess: () => "", onFailure: (why) => why })
      ).toContain(reason);

    refused("Looks fine to me!", "The reply was not one JSON document");
    // SAFETY: deliberately not a Severity, to see the schema refuse it.
    const urgent = "urgent" as never;

    refused(reply([finding({ severity: urgent })]), '["findings"][0]["severity"]');
    refused(reply([finding({ confidence: 2 })]), '["findings"][0]["confidence"]');
    refused(reply([finding({ startLine: 0 })]), '["findings"][0]["startLine"]');
  });

  test("drops Findings outside the diff and keeps the rest as agent Findings", async () => {
    const converted = await Effect.runPromise(
      toRiskFindings(
        [finding(), finding({ startLine: 40, endLine: 41 }), finding({ path: "x.ts" })],
        diff,
        file(0)
      )
    );

    expect(converted.dropped).toBe(2);
    expect(converted.findings).toHaveLength(1);
    expect(converted.findings[0]).toMatchObject({
      source: "agent",
      ruleId: null,
      status: "open",
      lines: { start: 11, end: 12, side: "new" },
    });
  });

  test("identity follows the code, not the line numbers", async () => {
    const shifted = parseDiff(PATCH.replace("@@ -10,3 +10,4 @@", "@@ -15,3 +15,4 @@"));
    const [a] = (await Effect.runPromise(toRiskFindings([finding()], diff, file(0)))).findings;

    const [b] = (
      await Effect.runPromise(
        toRiskFindings([finding({ startLine: 16, endLine: 17 })], shifted, file(5))
      )
    ).findings;

    expect(a?.identity).toBeDefined();
    expect(a?.identity).toBe(b?.identity);
  });
});
