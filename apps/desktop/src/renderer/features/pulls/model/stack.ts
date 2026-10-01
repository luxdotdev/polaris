/**
 * What the status pill, stack chip and popover, and branch chips say (DESIGN.md, Review →
 * Stacks). Pure, so it is tested.
 */
import type { ChecksView, PullStatus, StackView } from "../../../../shared/github.ts";
import { plural } from "../../../shell/copy.ts";

/** Branch names longer than this are cut with an ellipsis; the chip's tooltip has the rest. */
export const BRANCH_CHARS = 20;

export const shortBranch = (name: string, chars = BRANCH_CHARS) =>
  name.length <= chars + 1 ? name : `${name.slice(0, chars)}…`;

export const STATUS_LABELS: Readonly<Record<PullStatus, string>> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
};

/** "4 checks", "2 checks failing", "10 checks running". */
export const checksText = (checks: ChecksView | null): string | null => {
  if (checks === null) return null;

  const counted = plural(checks.total, "check");

  if (checks.state === "failure") return `${counted} failing`;

  return checks.state === "pending" ? `${counted} running` : counted;
};

/** The chip: "2/4". */
export const layerText = (stack: StackView) => `${stack.position}/${stack.size}`;

/** The popover's title: GitHub's "Stack #635", or how Polaris found it. */
export const stackTitle = (stack: StackView) =>
  stack.number === null ? "Stack from branch names" : `Stack #${stack.number}`;

/** Top (newest layer) first, as GitHub lists them; the trunk goes under the last. */
export const topDown = (stack: StackView) => stack.members.toReversed();
