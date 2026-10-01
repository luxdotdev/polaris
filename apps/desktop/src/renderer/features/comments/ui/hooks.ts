/** The open Agent Session's Harness, for "Goes to Claude Code with turn N" and its tile. */
import { useApp } from "../../../shell/hooks.ts";
import { useComments } from "../data/store.ts";

export const useSessionHarness = (subjectKey: string): string | null => {
  const session = useComments((s) => s.sessions[subjectKey]);

  return useApp((s) => {
    if (session === undefined) return null;

    for (const model of s.hostModels[session.hostKey]?.sessions.values() ?? []) {
      if (model.session.id === session.sessionId) return model.session.harness;
    }

    return null;
  });
};
