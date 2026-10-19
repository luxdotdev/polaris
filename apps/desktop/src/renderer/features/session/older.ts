/**
 * Older Turns (H-TRUTH's `session.turns`): the session feed opens with the last
 * 20 Turns; reaching the top of the list asks the Host for the 20 before them and
 * merges them into the store's model (`withOlderTurns`). A page that begins inside a
 * Turn (with a Turn the Harness started) fetches the page before it at once. A Snapshot after a
 * reconnect replaces the model, so paged Turns are fetched again when needed.
 */
import type { SessionId } from "@polaris/protocol";
import { useCallback, useEffect, useState } from "react";
import { useConnection } from "../../shell/hooks.ts";
import { withOlderTurns } from "../../store/sessionModel.ts";
import { sessionKey } from "../../store/store.ts";
import type { TurnView } from "../../store/sessionModel.ts";
import { polaris } from "../bridge.ts";
import type { OlderState } from "./model/conversation.ts";
import { continuesOlder } from "./model/turnGroups.ts";

/** Turns per page, as the feed's first page. */
export const OLDER_PAGE = 20;

export interface OlderTurns {
  /** The list's opening row state; null when there is nothing older to load. */
  readonly state: OlderState | null;
  readonly load: () => void;
}

export const useOlderTurns = (input: {
  readonly hostKey: string;
  readonly sessionId: SessionId;
  readonly turns: ReadonlyArray<TurnView>;
  /** The Host advertises `session.turn-paging`. */
  readonly enabled: boolean;
}): OlderTurns => {
  const { hostKey, sessionId, turns, enabled } = input;
  const { store } = useConnection();
  const [state, setState] = useState<OlderState>("idle");
  const first = turns[0]?.turn.index ?? 0;
  const more = enabled && first > 0;

  const load = useCallback(() => {
    if (!more || state === "loading") return;
    setState("loading");
    void polaris()
      .request("session.turns", { hostKey, sessionId, beforeIndex: first, limit: OLDER_PAGE })
      .then((result) => {
        if (!result.ok) {
          setState("failed");

          return;
        }

        const key = sessionKey(hostKey, sessionId);

        store.setState((s) => {
          const model = s.sessions[key];

          return model === undefined
            ? s
            : { sessions: { ...s.sessions, [key]: withOlderTurns(model, result.value) } };
        });
        setState("idle");
      });
  }, [more, state, hostKey, sessionId, first, store]);

  const partial = more && continuesOlder(turns);

  // A shown Turn split by the page boundary is completed before it is counted or numbered.
  useEffect(() => {
    if (partial && state === "idle") load();
  }, [partial, state, load]);

  return { state: more ? state : null, load };
};
