/**
 * Agent awareness for one Workspace: opens the feeds of its Working and Needs
 * You sessions (shared with the session view, no polling) and reads which
 * files they're on. The marks travel as a string so deltas don't re-render.
 */
import { SessionId } from "@polaris/protocol";
import { useEffect, useMemo } from "react";
import { useApp, useConnection } from "../../../../shell/hooks.ts";
import { sessionKey } from "../../../../store/store.ts";
import {
  type AgentEdit,
  agentMarks,
  type AgentMarks,
  noAgents,
  watchedSessions,
} from "../model/agents.ts";

const byPath = <V>([a]: readonly [string, V], [b]: readonly [string, V]) => a.localeCompare(b);

/** Edits carry the editing map (path → Harness), so only they and the blocked paths travel. */
const encode = (marks: AgentMarks) =>
  JSON.stringify([
    [...marks.edits].sort(byPath),
    [...marks.blocked].sort((a, b) => a.localeCompare(b)),
  ]);

const decode = (text: string): AgentMarks => {
  // SAFETY: `encode` above is the only writer.
  const [edits, blocked] = JSON.parse(text) as [Array<[string, AgentEdit]>, Array<string>];

  return {
    editing: new Map(edits.map(([path, edit]) => [path, edit.harness])),
    edits: new Map(edits),
    blocked: new Set(blocked),
  };
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

    if (model === undefined) return encode(noAgents);

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
