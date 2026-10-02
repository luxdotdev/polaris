/** Everything the explorer shows for one Workspace, live: rows, changes, git and agents. */
import { useMemo } from "react";
import { changeRows, type ChangeRow } from "../model/changes.ts";
import type { AgentMarks } from "../model/agents.ts";
import { noMarks } from "../model/git.ts";
import { type TreeInput, treeRows, type TreeRow } from "../model/tree.ts";
import { useAgentMarks } from "./agents.ts";
import { useListings, useRefresh } from "./fetch.ts";
import { useReveal } from "./reveal.ts";
import { explorerKey, type WorkspaceExplorer, useExplorerState } from "./store.ts";

export interface ExplorerData {
  readonly key: string;
  /** The folder shown: the Workspace's, or a Worktree or Review Checkout of it. */
  readonly root: string;
  readonly state: WorkspaceExplorer;
  readonly rows: ReadonlyArray<TreeRow>;
  readonly changes: ReadonlyArray<ChangeRow>;
  readonly agents: AgentMarks;
}

export const useExplorer = (
  hostKey: string,
  workspaceId: string,
  workspacePath: string
): ExplorerData => {
  const key = explorerKey(hostKey, workspaceId);
  const state = useExplorerState(key);
  const root = state.root ?? workspacePath;
  const agents = useAgentMarks(hostKey, workspaceId, root);
  const marks = state.git === null || state.git === "none" ? noMarks : state.git.marks;

  const input: TreeInput = useMemo(
    () => ({ root, listings: state.listings, expanded: state.expanded, marks, agents }),
    [root, state.listings, state.expanded, marks, agents]
  );

  useListings(key, hostKey, input);
  useRefresh(key, hostKey, root);
  useReveal(key, hostKey, workspacePath, state.reveal);

  const rows = useMemo(() => treeRows(input), [input]);
  const changes = useMemo(() => changeRows(root, marks, agents), [root, marks, agents]);

  return { key, root, state, rows, changes, agents };
};
