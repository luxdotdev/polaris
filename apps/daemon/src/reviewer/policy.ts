/** The Reviewer's sandbox runs allowed commands; escaped permission requests are declined. */
import { ApprovalDecision, type HarnessKind } from "@polaris/protocol";
import type { PolicyRequest } from "../services.ts";
import { which } from "../service/userPath.ts";

/**
 * Whether the Reviewer may run checks on this Harness: Codex's read-only
 * sandbox has no network; Claude Code's sandbox needs bubblewrap and socat on Linux.
 */
export const canRunChecks = (harness: HarnessKind, platform = process.platform): boolean => {
  if (harness === "codex") return true;

  if (harness !== "claude") return false;

  if (platform === "darwin") return true;

  return platform === "linux" && which("bwrap") !== null && which("socat") !== null;
};

/** Requests that escape the Harness's no-prompt policy are always declined. */
export const reviewerDecision = (_request: PolicyRequest): ApprovalDecision =>
  ApprovalDecision.cases.Deny.make({
    reason: "The Reviewer never requests permission. Run the command inside the read-only sandbox.",
  });
