import { LanguageCheckout } from "@polaris/protocol";
import type { AppState } from "../../../store/store.ts";
import type { EditorFile } from "../api.ts";
import type { PreviewDocument } from "../markdown/targets.ts";

const contains = (root: string, path: string) => path.startsWith(`${root.replace(/\/+$/, "")}/`);

/** Resolve actual registered checkout facts; a pane's root alone grants no media authority. */
export const previewDocument = (
  app: Pick<AppState, "hosts" | "hostModels">,
  file: EditorFile
): PreviewDocument | null => {
  const host = app.hosts.find((h) => h.key === file.hostKey)?.status.host;
  const model = app.hostModels[file.hostKey];
  const workspace = model?.workspaces.get(file.workspaceId);

  if (host == null || model === undefined || workspace === undefined) return null;
  const checkouts: Array<LanguageCheckout> = [];

  if (contains(workspace.path, file.path))
    checkouts.push(
      LanguageCheckout.cases.Workspace.make({
        workspaceId: workspace.id,
        path: workspace.path,
      })
    );

  for (const tree of model.worktrees.values()) {
    if (tree.workspaceId === workspace.id && contains(tree.path, file.path))
      checkouts.push(
        LanguageCheckout.cases.Worktree.make({
          workspaceId: workspace.id,
          worktreeId: tree.id,
          path: tree.path,
        })
      );
  }

  for (const checkout of model.reviewCheckouts.values()) {
    if (checkout.workspaceId === workspace.id && contains(checkout.path, file.path))
      checkouts.push(
        LanguageCheckout.cases.ReviewCheckout.make({
          workspaceId: workspace.id,
          reviewCheckoutId: checkout.id,
          path: checkout.path,
        })
      );
  }

  const checkout = checkouts.sort((a, b) => b.path.length - a.path.length)[0];

  return checkout === undefined ? null : { ...file, hostId: host.hostId, checkout };
};
