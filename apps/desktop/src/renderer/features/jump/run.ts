/** Carrying out a jump: select what was chosen (in Review with ⌘↵) or run the action. */
import { openPull, openSessionReview, reviewRoute } from "../../routes/review.ts";
import type { ShellActions } from "../../routes/navigation.ts";
import { revealInDiff, subjectKey, updateSurface } from "../review/index.ts";
import { barHosts } from "../../routes/topBar.ts";
import { useApp, useCommands, useSelection, useShellActions } from "../../shell/hooks.ts";
import type { JumpTarget } from "./items.ts";

type ReviewTarget = Extract<JumpTarget, { readonly kind: "pull" | "file" | "finding" }>;

const isReviewTarget = (target: JumpTarget): target is ReviewTarget =>
  target.kind === "pull" || target.kind === "file" || target.kind === "finding";

/** Review's own targets: open a pull request, or show a file or finding of the open Review. */
const runReviewTarget = (target: ReviewTarget, actions: ShellActions) => {
  if (target.kind === "pull") {
    openPull(actions, target.pull);

    return;
  }

  if (target.kind === "finding") {
    const { subject } = reviewRoute.getState();

    if (subject !== null) updateSurface(subjectKey(subject), { selectedFinding: target.findingId });
  }

  revealInDiff(
    target.path,
    target.kind === "file" ? 0 : target.line,
    target.kind === "file" ? "new" : target.side
  );
};

export const useRunJump = () => {
  const actions = useShellActions();
  const commands = useCommands();
  const { topBar } = useSelection();
  const hosts = useApp((s) => s.hosts);
  const models = useApp((s) => s.hostModels);

  return (target: JumpTarget, review: boolean) => {
    if (target.kind === "command") {
      commands.run(target.id);

      return;
    }

    if (isReviewTarget(target)) {
      runReviewTarget(target, actions);

      return;
    }

    if (target.kind === "session") {
      actions.selectSession(target);

      // ⌘↵ on a session reviews its Turns.
      if (review) {
        openSessionReview(actions, target.hostKey, target.sessionId);

        return;
      }
    } else if (target.kind === "workspace") actions.selectWorkspace(target);
    else if (target.kind === "worktree") {
      if (target.sessionId === null) actions.selectWorkspace(target);
      else actions.selectSession({ hostKey: target.hostKey, sessionId: target.sessionId });
    } else if (topBar === "workspaces") {
      // The Workspace bar has no machine to select: open the machine's first Workspace.
      const first = barHosts({ hosts, models }).find((h) => h.host.key === target.hostKey)
        ?.workspaces[0];

      if (first !== undefined) {
        actions.selectWorkspace({ hostKey: target.hostKey, workspaceId: first.workspace.id });
      }
    } else actions.selectHost(target.hostKey);

    if (review) actions.setMode("review");
  };
};
