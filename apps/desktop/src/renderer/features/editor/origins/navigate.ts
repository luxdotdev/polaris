/**
 * What the Origins card's rows open: a session at the Turn that wrote the line (Orchestrator),
 * or the commit's diff of the file (a diff tab). The shell's actions are bound by the pane.
 */
import type { BlameCommit, SessionId } from "@polaris/protocol";
import { requestTurn } from "../../session/revealTurn.ts";
import type { EditorFile } from "../api.ts";
import { openDiff } from "../diff/data/tabs.ts";
import { explorerKey, explorerOf } from "../explorer/data/store.ts";
import { type LineSession, openTurn } from "./model.ts";

type SelectSession = (target: { readonly hostKey: string; readonly sessionId: SessionId }) => void;

let select: SelectSession | null = null;

/** The editor pane, mounting: Origins open sessions through the shell from now on. */
export const bindOriginNavigation = (selectSession: SelectSession) => {
  select = selectSession;

  return () => {
    if (select === selectSession) select = null;
  };
};

export const openOriginSession = (line: LineSession) => {
  const turn = openTurn(line);
  const { hostKey } = line;
  const { sessionId } = line.session;

  if (turn !== null) requestTurn({ hostKey, sessionId, turnId: turn.turnId });
  select?.({ hostKey, sessionId });
};

/** The commit's change to the file; `path` is the file's path in that commit, from blame. */
export const openOriginCommit = (
  file: EditorFile,
  commit: BlameCommit,
  path: string,
  checkoutRoot: string
) => {
  const git = explorerOf(explorerKey(file.hostKey, file.workspaceId)).git;
  const toplevel = git === null || git === "none" ? checkoutRoot : git.toplevel;

  openDiff(
    {
      hostKey: file.hostKey,
      workspaceId: file.workspaceId,
      toplevel,
      path: file.path,
      repoPath: path,
      origRepoPath: null,
      side: "commit",
      git: "modified",
      sha: commit.sha,
    },
    true
  );
};
