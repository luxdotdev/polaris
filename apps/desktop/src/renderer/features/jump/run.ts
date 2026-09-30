/** Carrying out a jump: select what was chosen (in Review with ⌘↵) or run the action. */
import { barHosts } from "../../routes/topBar.ts";
import { useApp, useCommands, useSelection, useShellActions } from "../../shell/hooks.ts";
import type { JumpTarget } from "./items.ts";

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

    if (target.kind === "session") actions.selectSession(target);
    else if (target.kind === "workspace") actions.selectWorkspace(target);
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
