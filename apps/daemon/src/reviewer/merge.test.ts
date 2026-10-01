import { describe, expect, test } from "bun:test";
import {
  LineRange,
  RiskFinding,
  RiskFindingId,
  RiskSummary,
  RiskSummaryId,
  RiskSummaryKey,
  LayerRun,
  RiskSummaryLayers,
  ReviewSubject,
  SessionId,
  WorkspaceId,
} from "@polaris/protocol";
import { Effect } from "effect";
import { carried, relocate } from "./merge.ts";
import type { ReadLines } from "./output.ts";

const finding = (id: string, start: number, status: RiskFinding["status"] = "open") =>
  RiskFinding.make({
    id: RiskFindingId.make(id),
    identity: `identity-${id}`,
    source: "agent",
    ruleId: null,
    path: "a.ts",
    lines: LineRange.make({ start, end: start, side: "new" }),
    severity: "medium",
    confidence: 0.7,
    title: id,
    reason: "r",
    suggestion: null,
    status,
    resolution: null,
  });

const summary = (findings: ReadonlyArray<RiskFinding>) =>
  RiskSummary.make({
    id: RiskSummaryId.make(`rs-${findings.length}`),
    key: RiskSummaryKey.make({ repo: "r", mergeBase: "b", head: "h", since: null }),
    workspaceId: WorkspaceId.make("ws"),
    subject: ReviewSubject.cases.SessionTurns.make({
      sessionId: SessionId.make("s"),
      firstTurnId: null,
      lastTurnId: null,
    }),
    checkoutId: null,
    status: "completed",
    layers: RiskSummaryLayers.make({
      rules: LayerRun.make({ status: "completed", note: null }),
      agent: LayerRun.make({ status: "completed", note: null }),
    }),
    reviewer: null,
    cost: null,
    note: null,
    findings,
    startedAt: new Date(0).toISOString(),
    endedAt: null,
  });

const file =
  (lines: ReadonlyArray<string>): ReadLines =>
  () =>
    Effect.succeed(lines);

describe("carrying Findings forward", () => {
  test("relocate finds the block nearest its old place, ignoring whitespace", () => {
    const lines = ["a", "x  =  1", "b", "c", "x = 1"];

    expect(relocate(["x = 1"], lines, 4)).toBe(5);
    expect(relocate(["x = 1"], lines, 1)).toBe(2);
    expect(relocate(["gone"], lines, 1)).toBeNull();
    expect(relocate([""], lines, 1)).toBeNull();
  });

  test("moved code keeps the Finding open at its new lines; changed code resolves it as fixed", async () => {
    const before = file(["one", "risky()", "three"]);

    const previous = summary([
      finding("moved", 2),
      finding("dismissed", 2, "dismissed"),
      finding("done", 2, "resolved"),
    ]);

    const shifted = await Effect.runPromise(
      carried(previous, summary([]), before, file(["new", "one", "risky()", "three"]))
    );

    expect(shifted.map((f) => [String(f.id), f.status, f.lines.start])).toEqual([
      ["moved", "open", 3],
      ["dismissed", "dismissed", 3],
    ]);

    const rewritten = await Effect.runPromise(
      carried(previous, summary([]), before, file(["one", "safe()", "three"]))
    );

    expect(rewritten.map((f) => [String(f.id), f.status, f.resolution])).toEqual([
      ["moved", "resolved", "fixed"],
      ["dismissed", "resolved", "fixed"],
    ]);
  });

  test("a Finding this summary found again isn't carried twice", async () => {
    const previous = summary([finding("again", 1)]);

    const out = await Effect.runPromise(
      carried(previous, summary([finding("again", 1)]), file(["x"]), file(["x"]))
    );

    expect(out).toEqual([]);
  });
});
