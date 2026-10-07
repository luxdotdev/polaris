import * as P from "@polaris/protocol";
import { Match } from "effect";

/** Current registered checkout facts from one authenticated Host feed, never renderer caches. */
export class LanguageRegistrations {
  private sequence = -1;
  private readonly workspaces = new Map<string, P.Workspace>();
  private readonly worktrees = new Map<string, P.Worktree>();
  private readonly reviews = new Map<string, P.ReviewCheckout>();

  receive(item: P.HostStreamItem) {
    Match.value(item).pipe(
      Match.tag("Snapshot", (snapshot) => {
        if (snapshot.sequence < this.sequence) return;
        this.sequence = snapshot.sequence;
        this.workspaces.clear();
        this.worktrees.clear();
        this.reviews.clear();

        for (const workspace of snapshot.workspaces) this.workspaces.set(workspace.id, workspace);

        for (const tree of snapshot.worktrees) this.worktrees.set(tree.id, tree);

        for (const review of snapshot.reviewCheckouts ?? []) this.reviews.set(review.id, review);
      }),
      Match.tag("Event", ({ envelope }) => {
        if (envelope.sequence <= this.sequence) return;
        this.sequence = envelope.sequence;
        this.event(envelope.event);
      }),
      Match.orElse(() => undefined)
    );
  }

  private event(event: P.DomainEvent) {
    Match.value(event).pipe(
      Match.tag("WorkspaceRegistered", "WorkspaceUpdated", ({ workspace }) =>
        this.workspaces.set(workspace.id, workspace)
      ),
      Match.tag("WorkspaceRemoved", ({ workspaceId }) => {
        this.workspaces.delete(workspaceId);

        for (const [id, tree] of this.worktrees)
          if (tree.workspaceId === workspaceId) this.worktrees.delete(id);

        for (const [id, review] of this.reviews)
          if (review.workspaceId === workspaceId) this.reviews.delete(id);
      }),
      Match.tag("WorktreeDetected", ({ worktree }) => this.worktrees.set(worktree.id, worktree)),
      Match.tag("WorktreeRemoved", ({ worktreeId }) => this.worktrees.delete(worktreeId)),
      Match.tag("ReviewCheckoutOpened", "ReviewCheckoutChanged", ({ checkout }) =>
        this.reviews.set(checkout.id, checkout)
      ),
      Match.tag("ReviewCheckoutRemoved", ({ checkoutId }) => this.reviews.delete(checkoutId)),
      Match.orElse(() => undefined)
    );
  }

  workspace(id: P.WorkspaceId) {
    return this.workspaces.has(id);
  }

  checkout(checkout: P.LanguageCheckout) {
    if (!this.workspace(checkout.workspaceId)) return false;

    return P.LanguageCheckout.match(checkout, {
      Workspace: (value) => this.workspaces.get(value.workspaceId)?.path === value.path,
      Worktree: (value) => {
        const tree = this.worktrees.get(value.worktreeId);

        return tree?.workspaceId === value.workspaceId && tree.path === value.path;
      },
      ReviewCheckout: (value) => {
        const review = this.reviews.get(value.reviewCheckoutId);

        return (
          review?.workspaceId === value.workspaceId &&
          review.path === value.path &&
          review.state === "ready"
        );
      },
    });
  }
}
