/**
 * An Inspector's own policy (ADR 0119): it reads a worker's Claim, diff and checkout, so its
 * Harness opens read-only with the verdict server alone, and no request of its ever waits.
 */
import { type AgentSession, ApprovalDecision, harnessEntry } from "@polaris/protocol";
import { type HarnessDriver, HarnessError } from "../harness/HarnessDriver.ts";

export const isInspector = (session: AgentSession) => session.worker?.role === "inspector";

/** What an Inspector's approval request is answered with: a hidden session has no one to ask. */
export const inspectorDenial = ApprovalDecision.cases.Deny.make({
  reason:
    "An inspector never requests permission. Read inside the checkout, then record your verdict.",
});

/** Why this Harness can't run an Inspector, or null when its driver holds one to its checkout. */
export const inspectorRefusal = (
  capabilities: HarnessDriver["capabilities"],
  harness: AgentSession["harness"]
) =>
  capabilities.inspector === true
    ? null
    : new HarnessError({
        harness,
        message: `${harnessEntry(harness)?.name ?? harness} can't keep an inspector to its checkout. Choose Claude Code or Codex as the inspector in Settings → Constellations.`,
      });
