import { describe, expect, test } from "bun:test";
import type { SessionId } from "@polaris/protocol";
import { Subjects } from "../../../commands.ts";
import {
  captionOf,
  costLine,
  type Finding,
  groupFindings,
  isDimmed,
  notesOf,
  placeOf,
  provenanceOf,
  rank,
  rerunLabel,
  type Summary,
} from "./summary.ts";

const finding = (id: string, patch: Partial<Finding> = {}): Finding =>
  // SAFETY: test fixtures; the branded ids are plain strings at runtime.
  ({
    id,
    identity: `identity-${id}`,
    source: "agent",
    ruleId: null,
    path: "api/eligibility.ts",
    lines: { start: 41, end: 41, side: "new" },
    severity: "medium",
    confidence: 0.8,
    title: id,
    reason: "",
    suggestion: null,
    status: "open",
    resolution: null,
    ...patch,
  }) as Finding;

const summary = (patch: Partial<Summary> = {}): Summary =>
  // SAFETY: test fixture.
  ({
    id: "s1",
    key: { repo: "acme/widgets", mergeBase: "base000", head: "4f2c1a9e", since: null },
    workspaceId: "w1",
    subject: Subjects.SessionTurns({
      // SAFETY: a test id; SessionId is a branded string.
      sessionId: "x" as SessionId,
      firstTurnId: null,
      lastTurnId: null,
    }),
    checkoutId: null,
    status: "completed",
    layers: {
      rules: { status: "completed", note: null },
      agent: { status: "completed", note: null },
    },
    reviewer: { harness: "codex", model: "gpt-6.1-sol", effort: "high", sessionId: "r1" },
    cost: { tokens: 182_400, costUsd: 0.4 },
    note: null,
    findings: [],
    startedAt: "2026-10-01T10:00:00.000Z",
    endedAt: "2026-10-01T10:01:00.000Z",
    ...patch,
  }) as Summary;

describe("ranking", () => {
  test("Severity, then confidence, then rules before the reviewer", () => {
    const ranked = rank([
      finding("low", { severity: "low", confidence: 1 }),
      finding("high-agent", { severity: "high", confidence: 0.7 }),
      finding("high-rule", { severity: "high", confidence: 0.7, source: "rule" }),
      finding("crit", { severity: "critical", confidence: 0.2 }),
      finding("high-sure", { severity: "high", confidence: 0.9 }),
    ]);

    expect(ranked.map((f) => String(f.id))).toEqual([
      "crit",
      "high-sure",
      "high-rule",
      "high-agent",
      "low",
    ]);
  });

  test("low confidence dims everything but Critical", () => {
    expect(isDimmed(finding("a", { confidence: 0.49 }))).toBe(true);
    expect(isDimmed(finding("b", { confidence: 0.5 }))).toBe(false);
    expect(isDimmed(finding("c", { severity: "critical", confidence: 0.1 }))).toBe(false);
  });
});

describe("groups", () => {
  test("dismissed and resolved collapse; a Critical one never leaves the list", () => {
    const groups = groupFindings([
      finding("open"),
      finding("gone", { status: "dismissed" }),
      finding("withdrawn", { status: "resolved", resolution: "withdrawn" }),
      finding("crit", { severity: "critical", status: "dismissed" }),
    ]);

    expect(groups.listed.map((f) => String(f.id))).toEqual(["crit", "open"]);
    expect(groups.dismissed.map((f) => String(f.id))).toEqual(["gone"]);
    expect(groups.resolved.map((f) => String(f.id))).toEqual(["withdrawn"]);
    expect(groups.tally).toEqual({ critical: 1, high: 0, medium: 1, low: 0 });
  });
});

describe("labels", () => {
  test("place and provenance", () => {
    expect(placeOf(finding("a"))).toBe("api/eligibility.ts:41");
    expect(placeOf(finding("a", { lines: { start: 38, end: 39, side: "new" } }))).toBe(
      "api/eligibility.ts:38–39"
    );
    expect(provenanceOf(finding("a", { confidence: 0.857 }))).toBe("reviewer · 86%");
    expect(provenanceOf(finding("a", { source: "rule", confidence: 1 }))).toBe("rule · 100%");
  });

  test("the caption says what ran, where and when", () => {
    const now = Date.parse("2026-10-01T10:02:30.000Z");

    expect(captionOf(summary(), now)).toBe("Reviewed at 4f2c1a9 · 1m ago");
    expect(
      captionOf(
        summary({
          layers: {
            rules: { status: "completed", note: null },
            agent: { status: "skipped", note: "x" },
          },
        }),
        now
      )
    ).toBe("Rules ran at 4f2c1a9 · 1m ago");
    expect(
      captionOf(
        summary({ key: { repo: "r", mergeBase: "b", head: "bbbbbbbbb", since: "aaaaaaaaa" } }),
        now
      )
    ).toBe("Reviewed at bbbbbbb, new commits since aaaaaaa · 1m ago");
    expect(
      captionOf(
        summary({
          status: "running",
          endedAt: null,
          layers: {
            rules: { status: "running", note: null },
            agent: { status: "pending", note: null },
          },
        }),
        now
      )
    ).toBe("Running rules…");
    expect(captionOf(summary({ status: "failed" }), now)).toBe("Couldn’t finish at 4f2c1a9");
  });

  test("a waiting or switched-off reviewer offers Run reviewer", () => {
    const layers = (agent: "pending" | "skipped" | "completed") => ({
      rules: { status: "completed" as const, note: null },
      agent: { status: agent, note: null },
    });

    expect(rerunLabel(summary({ layers: layers("pending") }))).toBe("Run reviewer");
    expect(rerunLabel(summary({ layers: layers("skipped") }))).toBe("Run reviewer");
    expect(rerunLabel(summary({ layers: layers("completed") }))).toBe("Review again");
    expect(rerunLabel(null)).toBe("Review again");
  });

  test("notes are deduplicated and skip blanks", () => {
    const notes = notesOf(
      summary({
        note: "Rules only: no Reviewer is available",
        layers: {
          rules: { status: "completed", note: null },
          agent: { status: "skipped", note: "Rules only: no Reviewer is available" },
        },
      })
    );

    expect(notes).toEqual(["Rules only: no Reviewer is available"]);
  });

  test("the cost line", () => {
    const names = { harness: "Codex", model: "GPT-6.1-Sol · high" };

    expect(costLine(summary(), names)).toBe(
      "Reviewed by Codex · GPT-6.1-Sol · high · 182k tokens · ~$0.40"
    );
    expect(
      costLine(summary({ cost: { tokens: 900, costUsd: null } }), { ...names, model: null })
    ).toBe("Reviewed by Codex · 900 tokens");
    expect(costLine(summary({ reviewer: null }), names)).toBeNull();
  });
});
