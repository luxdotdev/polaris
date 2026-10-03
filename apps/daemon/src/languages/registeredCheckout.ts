import { LanguageCheckout, LanguageError } from "@polaris/protocol";
import type { ReadModel } from "../store/model.ts";
import type { CheckoutRegistration } from "./trust/checkout.ts";

const unavailable = () =>
  new LanguageError({
    reason: "not-owner",
    message: "Checkout is not registered",
    retryable: false,
  });

/** Resolve only the folded Daemon registry; caller paths never establish membership. */
export const registeredCheckout = (
  model: ReadModel,
  checkout: LanguageCheckout
): CheckoutRegistration => {
  const workspace = model.workspaces.get(checkout.workspaceId);

  if (workspace === undefined) throw unavailable();

  const registered = LanguageCheckout.match<LanguageCheckout>(checkout, {
    Workspace: () =>
      LanguageCheckout.cases.Workspace.make({ workspaceId: workspace.id, path: workspace.path }),
    Worktree: (value) => {
      const worktree = model.worktrees.get(value.worktreeId);

      if (worktree === undefined || worktree.workspaceId !== workspace.id) throw unavailable();

      return LanguageCheckout.cases.Worktree.make({
        workspaceId: workspace.id,
        worktreeId: worktree.id,
        path: worktree.path,
      });
    },
    ReviewCheckout: (value) => {
      const review = model.reviewCheckouts.get(value.reviewCheckoutId);

      if (review === undefined || review.workspaceId !== workspace.id || review.state !== "ready")
        throw unavailable();

      return LanguageCheckout.cases.ReviewCheckout.make({
        workspaceId: workspace.id,
        reviewCheckoutId: review.id,
        path: review.path,
      });
    },
  });

  return { checkout: registered, workspacePath: workspace.path };
};
