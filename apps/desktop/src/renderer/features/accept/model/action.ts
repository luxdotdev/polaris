/**
 * What the Review header's accept action says and offers for an Agent Session (Paper R2's
 * "Accept split button"), and what accepting will end in: a pull request, a push, or a
 * commit only. Pure.
 */
import type { AcceptBranchChoice } from "../../../../shared/acceptBranch.ts";
import type { RepoRef } from "../../../../shared/github.ts";

export interface PendingTurn {
  readonly id: string;
  readonly index: number;
}

/** "turn 24", "turns 22–24" (1-based, as the Turn picker counts). */
export const turnsLabel = (turns: ReadonlyArray<PendingTurn>): string => {
  const first = turns[0];
  const last = turns.at(-1);

  if (first === undefined || last === undefined) return "turns";

  return first.index === last.index
    ? `turn ${first.index + 1}`
    : `turns ${first.index + 1}–${last.index + 1}`;
};

export type HeaderAction =
  | { readonly kind: "accept"; readonly label: string }
  | { readonly kind: "paused"; readonly label: string; readonly critical: number }
  | { readonly kind: "working"; readonly label: string }
  | { readonly kind: "linked"; readonly label: string; readonly number: number }
  | { readonly kind: "none" };

export interface HeaderInput {
  readonly pending: ReadonlyArray<PendingTurn>;
  /** Open Critical Risk Findings on these Turns. */
  readonly critical: number;
  readonly working: boolean;
  readonly pullNumber: number | null;
}

export const headerAction = ({
  pending,
  critical,
  working,
  pullNumber,
}: HeaderInput): HeaderAction => {
  if (pending.length === 0) {
    return pullNumber === null
      ? { kind: "none" }
      : { kind: "linked", label: `Pull request #${pullNumber}`, number: pullNumber };
  }

  if (working) return { kind: "working", label: "Accept after this turn" };

  if (critical > 0) {
    return { kind: "paused", label: `Accept paused · ${critical} critical`, critical };
  }

  return { kind: "accept", label: `Accept ${turnsLabel(pending)}` };
};

/** Where accepting ends. */
export type AcceptEnd = "pull" | "push" | "commit";

export interface EndInput {
  readonly remote: { readonly url: string } | null;
  /** The remote as a GitHub repository; null for another code host. */
  readonly repo: RepoRef | null;
  readonly choice: AcceptBranchChoice;
  readonly current: string | null;
  readonly defaultBranch: string | null;
  /** The session already has a pull request: pushing updates it. */
  readonly linked: boolean;
}

export const acceptEnd = (input: EndInput): AcceptEnd => {
  if (input.remote === null) return "commit";

  if (input.repo === null || input.linked) return "push";

  const ontoDefault =
    input.choice.kind === "current" &&
    input.current !== null &&
    input.current === input.defaultBranch;

  return ontoDefault ? "push" : "pull";
};

export const SUBMIT_LABELS: Readonly<Record<AcceptEnd, string>> = {
  pull: "Commit, push and open PR",
  push: "Commit and push",
  commit: "Commit",
};

/** The popover's caption for the branch the commit lands on. */
export const branchCaption = (
  choice: AcceptBranchChoice,
  current: string | null,
  worktree: boolean
): string => {
  if (choice.kind === "create") return `on a new branch from ${current ?? "HEAD"}`;

  return worktree ? `on the worktree's branch ${current ?? ""}` : `on ${current ?? "HEAD"}`;
};
