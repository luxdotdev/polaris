/**
 * The changes lane of "Agent sessions ready": lines the session's not-yet-committed Turns
 * add and remove, from `session.acceptPlan` through the latest Turn (capability
 * `session.accept-latest`). Asked once per session and Turn count; blank until it answers.
 */
import { useEffect, useMemo } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { SessionInfo } from "../../review/model/queue.ts";
import { polaris } from "../../bridge.ts";
import type { Changes } from "../model/list.ts";

/** `hostKey:sessionId` → its changes at a Turn count. */
interface Known {
  readonly turnCount: number;
  readonly changes: Changes;
}

const changesStore = createStore<Readonly<Record<string, Known>>>(() => ({}));

const asked = new Set<string>();

const ask = (session: SessionInfo) => {
  const key = `${session.hostKey}:${session.id}`;
  const once = `${key}@${session.turnCount}`;

  if (asked.has(once)) return;
  asked.add(once);

  void polaris()
    .request("session.acceptPlan", {
      hostKey: session.hostKey,
      sessionId: session.id,
      throughTurnId: null,
    })
    .then((result) => {
      // Already committed, a Turn without checkpoints, or the Host away: the lane stays blank.
      if (!result.ok) return;
      const { additions, deletions } = result.value;

      changesStore.setState({
        [key]: { turnCount: session.turnCount, changes: { additions, deletions } },
      });
    });
};

/** `changesOf` for the list model; asks the Hosts for the ready sessions it doesn't know yet. */
export const useSessionChanges = (
  ready: ReadonlyArray<SessionInfo>,
  /** The Host plans through the latest Turn (capability `session.accept-latest`). */
  capable: (hostKey: string) => boolean
): ((hostKey: string, sessionId: string, turnCount: number) => Changes | null) => {
  const known = useStore(changesStore);

  useEffect(() => {
    for (const session of ready) if (capable(session.hostKey)) ask(session);
  }, [ready, capable]);

  return useMemo(
    () => (hostKey: string, sessionId: string, turnCount: number) => {
      const entry = known[`${hostKey}:${sessionId}`];

      // A newer Turn changed the lines: show nothing stale while it's asked again.
      return entry === undefined || entry.turnCount !== turnCount ? null : entry.changes;
    },
    [known]
  );
};
