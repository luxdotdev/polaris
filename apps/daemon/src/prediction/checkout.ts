import { LanguageCheckout, PredictionError } from "@polaris/protocol";
import type { WorkspaceId } from "@polaris/protocol";
import { resolve } from "node:path";
import type { ReadModel } from "../store/model.ts";
import { within } from "../languages/trust/checkout.ts";

export const invalidRequest = (message: string) =>
  new PredictionError({ reason: "invalid-request", message });

/** Prefer the most specific registered checkout, preserving Review Checkout Trust isolation. */
export function predictionCheckout(model: ReadModel, workspaceId: WorkspaceId, path: string) {
  const workspace = model.workspaces.get(workspaceId);

  if (workspace === undefined) throw invalidRequest("Workspace is not registered");
  const absolute = resolve(workspace.path, path);

  const candidates: LanguageCheckout[] = [
    LanguageCheckout.cases.Workspace.make({ workspaceId, path: workspace.path }),
  ];

  for (const worktree of model.worktrees.values()) {
    if (worktree.workspaceId === workspaceId)
      candidates.push(
        LanguageCheckout.cases.Worktree.make({
          workspaceId,
          worktreeId: worktree.id,
          path: worktree.path,
        })
      );
  }

  for (const review of model.reviewCheckouts.values()) {
    if (review.workspaceId === workspaceId && review.state === "ready")
      candidates.push(
        LanguageCheckout.cases.ReviewCheckout.make({
          workspaceId,
          reviewCheckoutId: review.id,
          path: review.path,
        })
      );
  }

  const checkout = candidates
    .filter((item) => within(resolve(item.path), absolute))
    .sort((a, b) => b.path.length - a.path.length)[0];

  if (checkout === undefined) throw invalidRequest("Path leaves registered checkouts");

  return { checkout, absolute };
}
