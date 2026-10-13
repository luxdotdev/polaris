/** The Reviewer's sandbox runs allowed commands; escaped permission requests are declined. */
import { ApprovalDecision, type HarnessKind } from "@polaris/protocol";
import type { PolicyRequest } from "../services.ts";
import { type ClaudeSandbox, probeClaudeSandbox } from "../harness/claude/sandbox.ts";

/**
 * What the Reviewer may run on this Host: `checks` (git, tests, lint in a sandbox
 * with no network), `git` (read-only git only) or `none` (no shell: it only reads files).
 */
export type ReviewerShell = "checks" | "git" | "none";

/**
 * Codex's read-only sandbox has no network. Claude Code's needs Seatbelt or
 * bubblewrap and socat; without it the Claude driver gives the Reviewer no shell.
 */
export const reviewerShell = (
  harness: HarnessKind,
  claudeSandbox: () => ClaudeSandbox = probeClaudeSandbox
): ReviewerShell => {
  if (harness === "codex") return "checks";

  if (harness !== "claude") return "git";

  return claudeSandbox().available ? "checks" : "none";
};

/** Requests that escape the Harness's no-prompt policy are always declined. */
export const reviewerDecision = (_request: PolicyRequest): ApprovalDecision =>
  ApprovalDecision.cases.Deny.make({
    reason: "The Reviewer never requests permission. Run the command inside the read-only sandbox.",
  });
