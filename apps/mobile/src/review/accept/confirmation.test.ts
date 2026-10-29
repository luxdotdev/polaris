import { describe, expect, test } from "bun:test";
import { RiskFinding, RiskFindingId } from "@polaris/protocol";
import { finding } from "../review.testing.ts";
import {
  type Acknowledged,
  acknowledge,
  acknowledgedIn,
  askLabel,
  canAccept,
  confirmationBody,
  confirmationTitle,
  moreCriticals,
  needsConfirmation,
  openCriticals,
  rememberAcknowledged,
} from "./confirmation.ts";

/** Accept pressed with `findings` open: whether it asked, and what it remembers after a confirm. */
const press = (findings: ReadonlyArray<RiskFinding>, acknowledged: Acknowledged) => {
  const criticals = openCriticals(findings);
  const asked = needsConfirmation(criticals, acknowledged);

  return { asked, after: asked ? acknowledge(acknowledged, criticals) : acknowledged };
};

describe("the Critical confirmation", () => {
  test("asks once for a set of open Criticals, then accepts straight through", () => {
    const findings = [finding("a", "critical"), finding("b", "critical"), finding("c", "high")];
    const first = press(findings, new Set());
    const second = press(findings, first.after);

    expect([first.asked, second.asked]).toEqual([true, false]);
  });

  test("asks again when a new Critical opens", () => {
    const first = press([finding("a", "critical")], new Set());
    const second = press([finding("a", "critical"), finding("b", "critical")], first.after);

    expect(second.asked).toBe(true);
  });

  test("doesn't ask again when the set only shrinks", () => {
    const first = press([finding("a", "critical"), finding("b", "critical")], new Set());

    expect(press([finding("a", "critical")], first.after).asked).toBe(false);
  });

  test("a re-run that reissues the same Critical under a new id doesn't ask again", () => {
    const original = finding("a", "critical");
    const first = press([original], new Set());

    const rerun = new RiskFinding({
      id: RiskFindingId.make("rerun-a"),
      identity: original.identity,
      source: original.source,
      ruleId: original.ruleId,
      path: original.path,
      lines: original.lines,
      severity: original.severity,
      confidence: original.confidence,
      title: original.title,
      reason: original.reason,
      suggestion: original.suggestion,
      status: original.status,
      resolution: original.resolution,
    });

    expect(press([rerun], first.after).asked).toBe(false);
  });

  test("never asks for dismissed or resolved Criticals, or for Highs", () => {
    const findings = [
      finding("a", "critical", { status: "dismissed" }),
      finding("b", "critical", { status: "resolved" }),
      finding("c", "high"),
    ];

    expect(press(findings, new Set()).asked).toBe(false);
  });

  test("Accept acts on a ready Turn with or without Criticals, and on nothing else", () => {
    expect(canAccept({ kind: "ready" })).toBe(true);
    expect(canAccept({ kind: "paused", critical: 1 })).toBe(true);

    for (const kind of ["checking", "working", "accepted", "sending"] as const)
      expect(canAccept({ kind })).toBe(false);
    expect(canAccept({ kind: "unchecked", reason: "offline" })).toBe(false);
  });
});

describe("its words", () => {
  test("name the turn, the count and the agent as MX-T does", () => {
    expect(confirmationTitle(1, 24)).toBe("Accept turn 24 with a critical open?");
    expect(confirmationTitle(2, 24)).toBe("Accept turn 24 with 2 criticals open?");
    expect(confirmationBody(1, "Claude Code")).toBe(
      "Accept anyway, or ask Claude Code about it first. You won't be asked again for this critical."
    );
    expect(confirmationBody(2, undefined)).toBe(
      "Accept anyway. You won't be asked again for these criticals."
    );
  });

  test("say them, not it, when several are open", () => {
    expect(confirmationBody(3, "Codex")).toBe(
      "Accept anyway, or ask Codex about them first. You won't be asked again for these criticals."
    );
    expect([askLabel(1, "Codex"), askLabel(3, "Codex")]).toEqual([
      "Ask Codex about it",
      "Ask Codex about them",
    ]);
  });

  test("count the criticals past the listed three", () => {
    expect([3, 4, 6].map(moreCriticals)).toEqual([
      null,
      "and 1 more critical",
      "and 3 more criticals",
    ]);
  });
});

describe("what was accepted despite", () => {
  test("outlives the screen that asked, within its agent session only", () => {
    const criticals = [finding("kept", "critical")];

    rememberAcknowledged("mac/session-a", criticals);

    // A remounted Review or queue reads the same session's acknowledgments back.
    expect(needsConfirmation(criticals, acknowledgedIn("mac/session-a"))).toBe(false);
    expect(needsConfirmation(criticals, acknowledgedIn("mac/session-b"))).toBe(true);
  });
});
