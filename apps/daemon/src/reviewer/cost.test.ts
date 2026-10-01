import { describe, expect, test } from "bun:test";
import { PlanLimit } from "@polaris/protocol";
import { planLimitNote } from "./cost.ts";

const limit = (harness: "claude" | "codex", status: PlanLimit["status"]) =>
  PlanLimit.make({
    harness,
    kind: "five-hour",
    scope: null,
    windowMinutes: 300,
    usedPercent: null,
    status,
    resetsAt: null,
    observedAt: new Date(0).toISOString(),
    plan: null,
  });

describe("the Plan Limit note", () => {
  test("only for the Reviewer's Harness, near or at a limit", () => {
    expect(planLimitNote("codex", [limit("codex", "ok"), limit("claude", "reached")])).toBeNull();
    expect(planLimitNote("codex", [limit("codex", "warning")])).toStartWith(
      "Codex is near a Plan Limit"
    );
    expect(planLimitNote("claude", [limit("claude", "reached")])).toStartWith(
      "Claude Code is at a Plan Limit"
    );
  });
});
