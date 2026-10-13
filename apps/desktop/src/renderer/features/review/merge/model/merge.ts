/**
 * What the header's Merge button says and does (DESIGN.md, Review → Merge): hidden when the
 * account can't merge or the pull request isn't open, "Merge" when GitHub would merge it now,
 * "Merge when ready" when auto-merge can wait out the rest, else "Merge blocked" with the
 * most pressing reason. Pure.
 */
import { Match } from "effect";
import type {
  BranchKeep,
  MergeBlock,
  MergeMethod,
  MergeView,
  ReviewersView,
} from "../../../../../shared/githubActions.ts";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The reason as the button says it, after "Merge blocked · ". */
export const blockShort = (block: MergeBlock): string =>
  Match.value(block).pipe(
    Match.discriminatorsExhaustive("kind")({
      closed: () => "closed",
      merged: () => "merged",
      draft: () => "draft",
      conflicts: () => "conflicts",
      "checks-failing": ({ count }) => `${plural(count, "check")} failing`,
      "checks-pending": ({ count }) => `${plural(count, "check")} running`,
      "changes-requested": () => "changes requested",
      "approval-required": () => "needs approval",
      behind: ({ base }) => `behind ${base}`,
      blocked: () => "branch rule",
      checking: () => "checking",
    })
  );

/** The reason as the merge popover lists it. */
export const blockLong = (block: MergeBlock): string =>
  Match.value(block).pipe(
    Match.discriminatorsExhaustive("kind")({
      closed: () => "It's closed",
      merged: () => "It's merged",
      draft: () => "It's a draft: mark it ready for review on GitHub",
      conflicts: () => "It conflicts with its base: resolve the conflicts first",
      "checks-failing": ({ count }) => `${plural(count, "required check")} failing`,
      "checks-pending": ({ count }) => `${plural(count, "required check")} still running`,
      "changes-requested": () => "A reviewer requested changes",
      "approval-required": () => "It needs an approving review",
      behind: ({ base }) => `It's behind ${base}: update the branch on GitHub`,
      blocked: () => "A branch rule blocks it",
      checking: () => "GitHub is still checking whether it can merge",
    })
  );

/** Blocks auto-merge waits out: running checks and reviews still to come. */
const WAITABLE = new Set<MergeBlock["kind"]>(["checks-pending", "approval-required"]);

export type MergeButton =
  | { readonly kind: "hidden" }
  | { readonly kind: "merge" }
  | { readonly kind: "auto" }
  | { readonly kind: "auto-on"; readonly method: MergeMethod }
  | { readonly kind: "blocked"; readonly reason: string };

export const mergeButton = (view: MergeView | null): MergeButton => {
  if (view === null || !view.viewerCanMerge || view.state !== "open") return { kind: "hidden" };

  if (view.autoMerge.enabled !== null)
    return { kind: "auto-on", method: view.autoMerge.enabled.method };

  if (view.blocks.length === 0) return { kind: "merge" };

  if (view.autoMerge.available && view.blocks.every((b) => WAITABLE.has(b.kind)))
    return { kind: "auto" };

  const [first] = view.blocks;

  return { kind: "blocked", reason: first === undefined ? "" : blockShort(first) };
};

export const BUTTON_LABEL: Readonly<Record<MergeButton["kind"], string>> = {
  hidden: "",
  merge: "Merge",
  auto: "Merge when ready",
  "auto-on": "Auto-merge on",
  blocked: "Merge blocked",
};

/**
 * Merge takes the header's primary when GitHub would merge it now and the viewer is done:
 * their own pull request, or one they approved. Submit review steps back then.
 */
export const mergeLeads = (view: MergeView | null, reviewers: ReviewersView | null) => {
  if (view === null || reviewers === null || mergeButton(view).kind !== "merge") return false;

  if (reviewers.author === view.viewerLogin) return true;

  return reviewers.reviewed.some((r) => r.login === view.viewerLogin && r.state === "approved");
};

export const METHOD_LABEL: Readonly<Record<MergeMethod, string>> = {
  merge: "Create a merge commit",
  squash: "Squash and merge",
  rebase: "Rebase and merge",
};

/** What each method does to the base, in one caption. */
export const methodCaption = (method: MergeMethod, commits: number, base: string) =>
  Match.value(method).pipe(
    Match.when("merge", () => `${plural(commits, "commit")} and a merge commit on ${base}`),
    Match.when("squash", () => `One commit on ${base}`),
    Match.when("rebase", () => `${plural(commits, "commit")} replayed on ${base}`),
    Match.exhaustive
  );

/** The primary's words for a method ("Squash and merge"), or auto-merge's. */
export const submitLabel = (method: MergeMethod, auto: boolean) =>
  auto ? "Merge when ready" : METHOD_LABEL[method];

/** Why the head branch stays, as the follow-up's caption says it; null when it may go. */
export const keepCaption = (keep: BranchKeep | null): string | null =>
  keep === null
    ? null
    : Match.value(keep).pipe(
        Match.when("default", () => "It's the default branch, so it stays"),
        Match.when("protected", () => "A branch rule protects it, so it stays"),
        Match.when("fork", () => "It's in a fork you can't write to, so it stays"),
        Match.when("gone", () => "It's already deleted"),
        Match.when("auto", () => "GitHub deletes it: the repository's setting"),
        Match.exhaustive
      );

/** The method to offer first: the last one used in this repository, else GitHub's default. */
export const firstMethod = (view: MergeView, last: MergeMethod | undefined): MergeMethod =>
  last !== undefined && view.methods.includes(last) ? last : view.defaultMethod;

/** One caption for the head commit's checks, when it has any. */
export const checksCaption = (view: MergeView): string | null => {
  const { total, failing, pending } = view.checks;

  if (total === 0) return null;
  const required = view.blocks.some((b) => b.kind === "checks-failing");

  if (failing > 0 && !required) return `${plural(failing, "check")} failing · not required`;

  if (failing > 0) return `${plural(failing, "check")} failing`;

  return pending > 0 ? `${plural(pending, "check")} running` : `${plural(total, "check")} passed`;
};
