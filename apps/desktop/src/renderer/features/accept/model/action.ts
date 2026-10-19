/**
 * What the Review header's accept action says and offers for an Agent Session (Paper R2's
 * "Accept split button"), and what accepting will end in: a pull request, a push, or a
 * commit only. Pure.
 */
import type { TurnId } from "@polaris/protocol";
import type { AcceptBranchChoice } from "../../../../shared/acceptBranch.ts";
import { turnRange } from "../../review/data/source.ts";
import type { RepoRef } from "../../../../shared/github.ts";

/** A Turn as the UI numbers it (`ReviewTurn`): the user's Turn and those the Harness started. */
export interface PendingTurn {
  readonly id: TurnId;
  readonly number: number;
  /** The Daemon's Turns in it after the last accept, in order, never empty. */
  readonly turns: ReadonlyArray<{ readonly id: TurnId; readonly status: string }>;
}

/** "turn 24", "turns 22–24", as the Turn picker numbers them. */
export const turnsLabel = turnRange;

/**
 * The Turn `AcceptTurns` takes to accept through `turn` (owner, 2026-10-19): its last, so the
 * Turns the Harness started after the user's are accepted with it.
 */
export const throughTurnId = (turn: PendingTurn): TurnId => turn.turns.at(-1)?.id ?? turn.id;

/** Accept waits while the session works or a pending Turn's last continuation still runs. */
export const acceptWaits = (
  state: string | undefined,
  pending: ReadonlyArray<PendingTurn>
): boolean =>
  state === "working" || pending.some((turn) => turn.turns.some((t) => t.status === "working"));

/** What accepting through a Turn takes. */
export interface AcceptChoice {
  /** The Daemon Turn `AcceptTurns` names. */
  readonly turnId: TurnId;
  /** The pending Turns up to it. */
  readonly turns: ReadonlyArray<PendingTurn>;
  /** Pending Turns after it. */
  readonly later: number;
}

export const acceptThrough = (
  pending: ReadonlyArray<PendingTurn>,
  through: PendingTurn
): AcceptChoice => {
  const at = pending.findIndex((t) => t.id === through.id);

  return {
    turnId: throughTurnId(through),
    turns: pending.slice(0, at + 1),
    later: pending.length - at - 1,
  };
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
