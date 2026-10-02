/**
 * Agent awareness for one Workspace: opens the feeds of its Working and Needs
 * You sessions (shared with the session view, no polling) and reads which
 * files they're on. The marks travel as a string so deltas don't re-render.
 */
import { SessionId } from "@polaris/protocol";
import { useEffect, useMemo } from "react";
import { useApp, useConnection } from "../../../../shell/hooks.ts";
import { sessionKey } from "../../../../store/store.ts";
import { agentMarks, type AgentMarks, watchedSessions } from "../model/agents.ts";

const encode = (marks: AgentMarks) =>
  JSON.stringify([
    [...marks.editing].sort(([a], [b]) => a.localeCompare(b)),
    [...marks.blocked].sort((a, b) => a.localeCompare(b)),
  ]);

const decode = (text: string): AgentMarks => {
  // SAFETY: `encode` above is the only writer.
  const [editing, blocked] = JSON.parse(text) as [Array<[string, string]>, Array<string>];

  return { editing: new Map(editing), blocked: new Set(blocked) };
};

/** The ids of the sessions worth following, joined, so the effect below only reruns on a change. */
const useWatchedIds = (hostKey: string, workspaceId: string, root: string) =>
  useApp((s) => {
    const sessions = s.hostModels[hostKey]?.sessions.values() ?? [];

    return watchedSessions(sessions, workspaceId, root)
      .map((e) => e.session.id)
      .join("\n");
  });

export const useAgentMarks = (hostKey: string, workspaceId: string, root: string): AgentMarks => {
  const { openSession } = useConnection();
  const ids = useWatchedIds(hostKey, workspaceId, root);

  useEffect(() => {
    const closes =
      ids === "" ? [] : ids.split("\n").map((id) => openSession(hostKey, SessionId.make(id)));

    return () => {
      for (const close of closes) close();
    };
  }, [openSession, hostKey, ids]);

  const text = useApp((s) => {
    const model = s.hostModels[hostKey];

    if (model === undefined) return encode({ editing: new Map(), blocked: new Set() });

    return encode(
      agentMarks({
        root,
        sessions: watchedSessions(model.sessions.values(), workspaceId, root),
        feed: (id) => s.sessions[sessionKey(hostKey, id)],
      })
    );
  });

  return useMemo(() => decode(text), [text]);
};
