/**
 * Removing a hidden Workspace (docs/adr/0086): `RemoveWorkspace` to its Host, which purges its
 * agent sessions and constellations; then the per-Workspace settings this Mac and the Host keep
 * for it go too. The folder on disk is never touched.
 */
import type { WorkspaceId } from "@polaris/protocol";
import { workspaceKeyOf } from "../../../shared/acceptBranch.ts";
import { Commands } from "../../commands.ts";
import { polaris } from "../bridge.ts";
import { send } from "../session/dispatch.ts";
import { withOverride } from "./model/reviewer.ts";
import { setSessionPrefs, settingsStore } from "./store.ts";

/** The Host's Reviewer override for the Workspace, if it has one. */
const dropReviewerOverride = async (hostKey: string, workspaceId: string) => {
  const current = await polaris().request("review.reviewerSettings", {
    hostKey,
    workspaceId: null,
  });

  if (!current.ok || current.value.settings.workspaces[workspaceId] === undefined) return;
  const settings = withOverride(current.value.settings, workspaceId, null);

  await polaris().request("review.setReviewerSettings", { hostKey, settings });
};

/** This Mac's overrides for the Workspace: where accepted Turns commit, and its GitHub account. */
const dropLocalOverrides = async (hostKey: string, workspaceId: string) => {
  const key = workspaceKeyOf(hostKey, workspaceId);
  const { workspaceAcceptBranch } = settingsStore.getState().sessions;

  if (workspaceAcceptBranch[key] !== undefined) {
    setSessionPrefs({
      workspaceAcceptBranch: Object.fromEntries(
        Object.entries(workspaceAcceptBranch).filter(([k]) => k !== key)
      ),
    });
  }

  await polaris().request("github.routing.setWorkspace", {
    workspace: { hostKey, workspaceId },
    accountId: null,
  });
};

/** True once the Host removed it; a refusal is toasted with the Daemon's reason. */
export const removeWorkspace = async (hostKey: string, workspaceId: string): Promise<boolean> => {
  const removed = await send(
    hostKey,
    // SAFETY: the id came from this Host's own Workspace list.
    Commands.RemoveWorkspace({ workspaceId: workspaceId as WorkspaceId }),
    "Couldn't remove the workspace"
  );

  if (removed) {
    await Promise.allSettled([
      dropReviewerOverride(hostKey, workspaceId),
      dropLocalOverrides(hostKey, workspaceId),
    ]);
  }

  return removed;
};
