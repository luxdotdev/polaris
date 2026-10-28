import { describe, expect, test } from "bun:test";
import { acceptLabel } from "./copy.ts";
import { acceptState, isDimmed, listedFindings, tally } from "./model.ts";
import { finding, summary } from "./review.testing.ts";

const ready = { turnEnded: true, accepted: false, sending: false };

const risk = (...findings: ReturnType<typeof finding>[]) =>
  ({ kind: "ready", value: summary("completed", findings) }) as const;

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
      risk: risk(finding("a", "critical"), finding("b", "critical"), finding("c", "high")),
    });

    expect(state).toEqual({ kind: "paused", critical: 2 });
  });

  test("goes ahead once the only Critical is dismissed, even though it stays listed", () => {
    expect(
      acceptState({ ...ready, risk: risk(finding("a", "critical", { status: "dismissed" })) })
    ).toEqual({ kind: "ready" });
  });

  test("waits for a Turn still working, and stays accepted once accepted", () => {
    expect(acceptState({ ...ready, turnEnded: false, risk: risk() }).kind).toBe("working");
    expect(
      acceptState({ ...ready, accepted: true, risk: risk(finding("a", "critical")) }).kind
    ).toBe("accepted");
  });

  test("stays paused while the risk summary loads, then pauses for the Critical it brings", () => {
    const loading = acceptState({ ...ready, risk: { kind: "loading" } });
    const running = acceptState({ ...ready, risk: { kind: "ready", value: summary("running") } });

    const critical = acceptState({
      ...ready,
      risk: { kind: "ready", value: summary("running", [finding("late", "critical")]) },
    });

    expect([loading.kind, running.kind]).toEqual(["checking", "checking"]);
    expect(acceptLabel(loading, 3)).toBe("Accept waits for the risk summary");
    expect(critical).toEqual({ kind: "paused", critical: 1 });
  });

  test("stays paused when the risk summary can't load or fails, and says why", () => {
    const unloaded = acceptState({
      ...ready,
      risk: { kind: "failed", message: "The host isn't connected" },
    });

    const failed = acceptState({
      ...ready,
      risk: { kind: "ready", value: summary("failed", [], "The rules layer crashed") },
    });

    expect(unloaded).toEqual({ kind: "unchecked", reason: "The host isn't connected" });
    expect(failed).toEqual({ kind: "unchecked", reason: "The rules layer crashed" });
    expect(acceptLabel(unloaded, 3)).toBe("Accept paused · no risk summary");
  });

  test("goes ahead once the risk summary has finished with no open Critical", () => {
    expect(acceptState({ ...ready, risk: risk(finding("h", "high")) }).kind).toBe("ready");
  });
});
