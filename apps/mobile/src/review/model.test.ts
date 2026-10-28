import { describe, expect, test } from "bun:test";
import { acceptState, isDimmed, listedFindings, tally } from "./model.ts";
import { finding } from "./review.testing.ts";

const ready = { turnEnded: true, accepted: false, sending: false };

describe("which findings stay listed", () => {
  test("a dismissed Critical stays listed; a dismissed High and a resolved Critical don't", () => {
    const listed = listedFindings([
      finding("a", "critical", { status: "dismissed" }),
      finding("b", "high", { status: "dismissed" }),
      finding("c", "critical", { status: "resolved" }),
      finding("d", "low"),
    ]);

    expect(listed.map((f) => f.identity)).toEqual(["a", "d"]);
  });

  test("the tally counts a dismissed Critical, so no verdict hides it", () => {
    expect(
      tally([finding("a", "critical", { status: "dismissed" }), finding("b", "medium")])
    ).toEqual({
      critical: 1,
      high: 0,
      medium: 1,
      low: 0,
    });
  });

  test("a low-confidence Critical is never dimmed; a low-confidence High is", () => {
    expect(isDimmed(finding("a", "critical", { confidence: 0.2 }))).toBe(false);
    expect(isDimmed(finding("b", "high", { confidence: 0.2 }))).toBe(true);
  });
});

describe("Accept", () => {
  test("is paused while a Critical finding is open, and counts them", () => {
    const state = acceptState({
      ...ready,
      findings: [finding("a", "critical"), finding("b", "critical"), finding("c", "high")],
    });

    expect(state).toEqual({ kind: "paused", critical: 2 });
  });

  test("goes ahead once the only Critical is dismissed, even though it stays listed", () => {
    expect(
      acceptState({ ...ready, findings: [finding("a", "critical", { status: "dismissed" })] })
    ).toEqual({ kind: "ready" });
  });

  test("waits for a Turn still working, and stays accepted once accepted", () => {
    expect(acceptState({ ...ready, turnEnded: false, findings: [] }).kind).toBe("working");
    expect(
      acceptState({ ...ready, accepted: true, findings: [finding("a", "critical")] }).kind
    ).toBe("accepted");
  });
});
