import { describe, expect, test } from "bun:test";
import { IntentGroup, RiskSummary, Walkthrough } from "@polaris/protocol";
import { summary } from "../review.testing.ts";
import { walkthroughCaption, walkthroughLine } from "./walkthrough.ts";

const group = (key: string, critical = false) =>
  new IntentGroup({
    key,
    label: key,
    summary: "why",
    category: "config",
    critical,
    paths: [`${key}.ts`],
  });

const walkthrough = (state: Walkthrough["state"], groups: ReadonlyArray<IntentGroup> = []) =>
  new Walkthrough({
    groups,
    state,
    markdown: "",
    head: "b",
    fromHead: null,
    fullSummaryId: null,
    harness: null,
    model: null,
    effort: null,
    sessionId: null,
    lines: 0,
    tokensEstimate: null,
    filesRead: 0,
    filesTotal: 0,
    startedAt: null,
    durationMs: null,
    tokens: null,
    reason: null,
    evidence: null,
  });

const withWalkthrough = (w: Walkthrough) => {
  const base = summary("completed");

  return new RiskSummary({
    walkthrough: w,
    id: base.id,
    key: base.key,
    workspaceId: base.workspaceId,
    subject: base.subject,
    checkoutId: base.checkoutId,
    status: base.status,
    layers: base.layers,
    reviewer: base.reviewer,
    cost: base.cost,
    note: base.note,
    findings: base.findings,
    startedAt: base.startedAt,
    endedAt: base.endedAt,
  });
};

describe("the walkthrough line", () => {
  test("counts the intent groups once ready, and opens them", () => {
    const line = walkthroughLine(withWalkthrough(walkthrough("ready", [group("a"), group("b")])));

    expect(line?.text).toBe("Walkthrough · 2 intent groups");
    expect(line?.groups?.length).toBe(2);
  });

  test("says where it is before then, and opens nothing", () => {
    expect(walkthroughLine(withWalkthrough(walkthrough("writing")))).toEqual({
      text: "Walkthrough · writing…",
      groups: null,
    });
  });

  test("is absent when the walkthrough is off or the host sends none", () => {
    expect(walkthroughLine(withWalkthrough(walkthrough("off")))).toBeNull();
    expect(walkthroughLine(summary("completed"))).toBeNull();
  });

  test("the sheet's caption counts the groups that need extra care", () => {
    expect(walkthroughCaption(24, [group("a", true), group("b"), group("c")])).toBe(
      "Turn 24 · 3 intent groups · 1 needs extra care"
    );
    expect(walkthroughCaption(3, [group("a")])).toBe("Turn 3 · 1 intent group");
  });
});
