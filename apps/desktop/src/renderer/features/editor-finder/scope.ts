/** Where ⌘P and ⌘⇧F search: the place the user is looking at. */
import type { WorkspaceId } from "@polaris/protocol";
import { useApp, useSelection } from "../../shell/hooks.ts";
import { useReviewPlace } from "../editor-links/index.ts";

export interface Scope {
  readonly hostKey: string;
  readonly workspaceId: WorkspaceId;
  readonly root: string;
  readonly name: string;
}

const folderName = (path: string) => path.slice(path.replace(/\/+$/, "").lastIndexOf("/") + 1);

/**
 * Where ⌘P searches: in Review, the open subject's Review Checkout (or session cwd); in
 * Orchestrate, the selected session's cwd; otherwise the selected Workspace's folder.
 */
export const useFinderScope = (): Scope | null => {
  const { hostKey, workspaceId, sessionId, mode } = useSelection();
  const review = useReviewPlace();
  const model = useApp((s) => (hostKey === null ? undefined : s.hostModels[hostKey]));
  const workspace = workspaceId === null ? undefined : model?.workspaces.get(workspaceId);

  const reviewWorkspace = review?.workspaceId ?? null;

  if (mode === "review" && review !== null && review.root !== null && reviewWorkspace !== null)
    return {
      hostKey: review.hostKey,
      workspaceId: reviewWorkspace,
      root: review.root,
      name: folderName(review.root),
    };

  if (hostKey === null || workspace === undefined) return null;
  const session = sessionId === null ? undefined : model?.sessions.get(sessionId)?.session;
  const root = mode === "orchestrate" && session !== undefined ? session.cwd : workspace.path;

  return { hostKey, workspaceId: workspace.id, root, name: workspace.name };
};
