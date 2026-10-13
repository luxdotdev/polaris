/**
 * What Review offers on an open pull request besides reviewing it: who is asked to review,
 * and merging (ENG-229, ENG-228). Views the renderer gets from `github.pull.actions` and
 * the merge's answer. No Effect code: the renderer imports this file at runtime.
 */

/** GitHub's merge methods, as its merge button names them. */
export type MergeMethod = "merge" | "squash" | "rebase";

export const MERGE_METHODS: ReadonlyArray<MergeMethod> = ["merge", "squash", "rebase"];

/** The head commit's checks, counted. */
export interface CheckCounts {
  readonly total: number;
  readonly failing: number;
  readonly pending: number;
}

/**
 * Why GitHub won't merge it now, most pressing first. `checking`: GitHub hasn't worked out
 * mergeability yet; `blocked`: a branch rule Polaris can't name (GitHub says only BLOCKED).
 */
export type MergeBlock =
  | { readonly kind: "closed" }
  | { readonly kind: "merged" }
  | { readonly kind: "draft" }
  | { readonly kind: "conflicts" }
  | { readonly kind: "checks-failing"; readonly count: number }
  | { readonly kind: "checks-pending"; readonly count: number }
  | { readonly kind: "changes-requested" }
  | { readonly kind: "approval-required" }
  | { readonly kind: "behind"; readonly base: string }
  | { readonly kind: "blocked" }
  | { readonly kind: "checking" };

/**
 * Why the head branch stays after a merge. `default`: it is the repository's default branch;
 * `protected`: a branch rule protects it; `fork`: it lives in a fork the account can't write
 * to; `gone`: it no longer exists; `auto`: GitHub deletes it itself (the repository's setting).
 */
export type BranchKeep = "default" | "protected" | "fork" | "gone" | "auto";

export interface MergeMessage {
  readonly title: string;
  readonly body: string;
}

export interface AutoMergeView {
  /** The repository allows auto-merge and GitHub lets this account turn it on now. */
  readonly available: boolean;
  /** On already: how it will merge, and who turned it on. */
  readonly enabled: { readonly method: MergeMethod; readonly by: string | null } | null;
}

export interface MergeView {
  readonly pullId: string;
  readonly number: number;
  readonly repo: string;
  /** Main always sets it; absent means github.com. */
  readonly host?: string;
  readonly state: "open" | "closed" | "merged";
  readonly headRefName: string;
  readonly headRefOid: string;
  readonly baseRefName: string;
  /** The routed account's login, which merges. */
  readonly viewerLogin: string;
  /** Write, maintain or admin on the repository: without it the merge isn't offered at all. */
  readonly viewerCanMerge: boolean;
  /** Empty when GitHub would merge it now. */
  readonly blocks: ReadonlyArray<MergeBlock>;
  readonly checks: CheckCounts;
  /** The repository's allowed methods, in GitHub's order. */
  readonly methods: ReadonlyArray<MergeMethod>;
  /** GitHub's default for this viewer and repository, when it's allowed. */
  readonly defaultMethod: MergeMethod;
  readonly autoMerge: AutoMergeView;
  /** GitHub's suggested commit message per method (rebase has none). */
  readonly messages: { readonly merge: MergeMessage; readonly squash: MergeMessage };
  /** Whether the head branch may be deleted after the merge; `keep` says why not. */
  readonly branch: { readonly name: string; readonly keep: BranchKeep | null };
}

export type ReviewState = "approved" | "changes-requested" | "commented" | "dismissed" | "pending";

/** Someone who can be asked for a review: a user (`login`) or a team (`slug`). */
export interface ReviewerView {
  readonly kind: "user" | "team";
  /** The user's login or the team's slug. */
  readonly login: string;
  readonly name: string | null;
}

/** A reviewer's latest review. */
export interface ReviewedByView {
  readonly login: string;
  readonly state: ReviewState;
  readonly at: string | null;
}

export interface ReviewersView {
  /** Asked now and not yet answered. */
  readonly requested: ReadonlyArray<ReviewerView>;
  /** Each reviewer's latest review, newest first. */
  readonly reviewed: ReadonlyArray<ReviewedByView>;
  /** GitHub's suggestions (recent authors of these lines), best first. */
  readonly suggested: ReadonlyArray<ReviewerView>;
  /** Triage or more: asking for reviews needs it. */
  readonly canRequest: boolean;
  readonly author: string | null;
}

export interface PullActionsView {
  readonly merge: MergeView;
  readonly reviewers: ReviewersView;
}

/** What happened to the head branch after a merge. */
export type BranchOutcome =
  | {
      readonly kind: "deleted";
      readonly name: string;
      readonly sha: string;
      /** The repository it lived in (`owner/name`; a fork's for a fork), to restore it. */
      readonly repo: string;
      /** GitHub deleted it itself (the repository's setting). */
      readonly byGitHub: boolean;
    }
  | { readonly kind: "kept"; readonly name: string; readonly reason: BranchKeep | "asked" }
  | { readonly kind: "failed"; readonly name: string; readonly message: string };

export interface MergeResult {
  readonly method: MergeMethod;
  readonly mergedAt: string | null;
  readonly branch: BranchOutcome;
}

/** A user or team slug GitHub would accept: letters, digits, `-`, `_`, `.`. */
export const REVIEWER_PATTERN = /^[A-Za-z0-9_.-]+$/;
