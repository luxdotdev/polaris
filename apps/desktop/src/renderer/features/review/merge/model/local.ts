/**
 * What Polaris itself holds for a pull request on the Hosts, that a merge can clean up: the
 * Review Checkout (a detached worktree on review refs) and, for a pull request an accepted
 * Agent Session opened, that session's worktree and branch. Nothing else is touched: a
 * branch the user made outside Polaris is never in this list. Pure.
 */
import type { ReviewCheckout, SessionId } from "@polaris/protocol";
import type { PullRef } from "../../../../../shared/github.ts";
import type { HostModel } from "../../../../store/hostModel.ts";

export interface HeldCheckout {
  readonly hostKey: string;
  readonly hostLabel: string;
  readonly checkout: ReviewCheckout;
}

/** The accepted Agent Session that opened the pull request, with the branch its worktree holds. */
export interface LinkedSession {
  readonly hostKey: string;
  readonly hostLabel: string;
  readonly sessionId: SessionId;
  readonly title: string;
  /** Its own worktree's branch; null when it worked in the Workspace's checkout. */
  readonly branch: string | null;
}

const samePull = (
  ref: {
    readonly repo: { readonly owner: string; readonly name: string };
    readonly number: number;
  },
  pull: PullRef
) =>
  ref.number === pull.number &&
  ref.repo.owner.toLowerCase() === pull.repo.owner.toLowerCase() &&
  ref.repo.name.toLowerCase() === pull.repo.name.toLowerCase();

/** The session's own worktree branch: one it created, never the Workspace's main checkout. */
const ownBranch = (model: HostModel, sessionId: string, worktreeId: string | null) => {
  const worktree = worktreeId === null ? undefined : model.worktrees.get(worktreeId);

  return worktree !== undefined && worktree.createdBySessionId === sessionId && !worktree.isMain
    ? worktree.branch
    : null;
};

export const linkedSessionOf = (
  models: Readonly<Record<string, HostModel>>,
  labelOf: (hostKey: string) => string,
  pull: PullRef
): LinkedSession | null => {
  for (const [hostKey, model] of Object.entries(models)) {
    for (const { session } of model.sessions.values()) {
      const ref = session.pullRequest ?? null;

      if (ref === null || session.state === "archived" || !samePull(ref, pull)) continue;

      return {
        hostKey,
        hostLabel: labelOf(hostKey),
        sessionId: session.id,
        title: session.title,
        branch: ownBranch(model, session.id, session.worktreeId ?? null),
      };
    }
  }

  return null;
};
