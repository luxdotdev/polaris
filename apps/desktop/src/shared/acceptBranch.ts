/**
 * Where accepting an Agent Session's work commits (ENG-224), from Settings → Sessions:
 * the Workspace's override, else the default. A session on a Worktree always uses its
 * Worktree's branch. Pure, so main, the renderer and tests share it.
 */
import type { AcceptBranchMode, SessionPrefs } from "./contract.ts";

/** What the accept flow passes to the Daemon's `AcceptBranch` (Current or Create). */
export type AcceptBranchChoice =
  | { readonly kind: "current" }
  | { readonly kind: "create"; readonly name: string };

/** The key Settings stores a Workspace's override under, as the GitHub routing does. */
export const workspaceKeyOf = (hostKey: string, workspaceId: string) => `${hostKey}/${workspaceId}`;

export const acceptBranchMode = (
  prefs: Pick<SessionPrefs, "acceptBranch" | "workspaceAcceptBranch">,
  workspaceKey: string
): AcceptBranchMode => prefs.workspaceAcceptBranch[workspaceKey] ?? prefs.acceptBranch;

/** The facts of the accept plan the choice depends on (`AcceptPlan`'s fields). */
export interface AcceptBranchFacts {
  /** Checked out now; null when HEAD is detached. */
  readonly branch: string | null;
  /** The remote's default branch; null when unknown. */
  readonly defaultBranch: string | null;
  readonly worktree: boolean;
}

/** On the default branch, or detached (nothing to commit onto). Unknown default: `main`/`master`. */
const onDefaultBranch = ({ branch, defaultBranch }: AcceptBranchFacts) => {
  if (branch === null) return true;

  return defaultBranch === null
    ? branch === "main" || branch === "master"
    : branch === defaultBranch;
};

export const acceptBranchFor = (
  mode: AcceptBranchMode,
  facts: AcceptBranchFacts,
  /** `<prefix><slug>`: Settings → Sessions' branch prefix and the session's slug. */
  newBranch: string
): AcceptBranchChoice => {
  if (facts.worktree && facts.branch !== null) return { kind: "current" };

  const create =
    facts.branch === null || mode === "create" || (mode === "auto" && onDefaultBranch(facts));

  return create ? { kind: "create", name: newBranch } : { kind: "current" };
};

/** How Settings names each mode. */
export const ACCEPT_BRANCH_LABELS: Readonly<Record<AcceptBranchMode, string>> = {
  auto: "Branch only from the default branch",
  current: "Commit to the current branch",
  create: "Always create a branch",
};
