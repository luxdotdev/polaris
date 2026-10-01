/**
 * React access to Constellations: the read model by Host or Lead, a worker's Attempt, the
 * facts the rail needs, and the focus. Shared with shellui through index.ts.
 */
import type { SessionId } from "@polaris/protocol";
import { useMemo, useSyncExternalStore } from "react";
import { useApp, useConnection, useShellActions } from "../../shell/hooks.ts";
import { useNow } from "../../shell/useNow.ts";
import type { AppState } from "../../store/store.ts";
import { hostKeyOf, receiptFrom, workerFactsFrom } from "./liveFacts.ts";
import {
  type AttemptData,
  type ConstellationRecord,
  type ConstellationView,
  emptyConstellations,
  type Facts,
  NO_FACTS,
  type TaskData,
  type WorkerFacts,
} from "./model/index.ts";
import { type Focus, leadKey, patchLeadUi, useLeadUi, useSignals } from "./state.ts";

const NONE: ReadonlyArray<ConstellationRecord> = [];

const listOf = (state: AppState, hostKey: string) =>
  state.constellations[hostKey] ?? emptyConstellations;

/** Every Constellation on a Host, newest first. */
export const useConstellations = (hostKey: string | null): ReadonlyArray<ConstellationView> => {
  const model = useApp((s) => (hostKey === null ? emptyConstellations : listOf(s, hostKey)));

  return useMemo(
    () =>
      model.byId.size === 0
        ? NONE
        : [...model.byId.values()].toSorted((a, b) =>
            b.constellation.createdAt.localeCompare(a.constellation.createdAt)
          ),
    [model]
  );
};

/** Every Host's Constellations, for views across Hosts (Needs you, Review, Usage). */
export const useAllConstellations = (): Readonly<
  Record<string, ReadonlyArray<ConstellationView>>
> => {
  const all = useApp((s) => s.constellations);

  return useMemo(
    () =>
      Object.fromEntries(
        Object.entries(all).map(([key, model]) => [key, [...model.byId.values()]])
      ),
    [all]
  );
};

const leadRecord = (state: AppState, hostKey: string, leadSessionId: string) => {
  for (const r of listOf(state, hostKey).byId.values())
    if (r.constellation.leadSessionId === leadSessionId && r.constellation.state !== "archived")
      return r;

  return null;
};

/** The Constellation this session leads, with its event-only extras; null for other sessions. */
export const useLeadConstellation = (
  hostKey: string,
  leadSessionId: string
): ConstellationRecord | null => useApp((s) => leadRecord(s, hostKey, leadSessionId));

/** A snapshot that keeps its identity while its fingerprint holds, so frames don't re-render. */
const useStable = <A>(select: (s: AppState) => A, print: (a: A) => string): A => {
  const { store } = useConnection();

  const snapshot = useMemo(() => {
    let last: { readonly key: string; readonly value: A } | null = null;

    return () => {
      const value = select(store.getState());
      const key = print(value);

      if (last !== null && last.key === key) return last.value;
      last = { key, value };

      return value;
    };
  }, [store, select, print]);

  return useSyncExternalStore(store.subscribe, snapshot);
};

export interface WorkerAttempt {
  readonly view: ConstellationRecord;
  /** The Lead's Host, where the Constellation lives. */
  readonly leadHostKey: string;
  readonly task: TaskData;
  readonly attempt: AttemptData;
}

const workerAttempt = (state: AppState, hostKey: string, sessionId: string) => {
  const hostId = state.hosts.find((h) => h.key === hostKey)?.status.host?.hostId;

  for (const [leadHostKey, model] of Object.entries(state.constellations)) {
    for (const view of model.byId.values()) {
      const attempt = view.constellation.attempts.findLast(
        (a) => a.sessionId === sessionId && (hostId === undefined || a.hostId === hostId)
      );

      const task = view.constellation.tasks.find((t) => t.id === attempt?.taskId);

      if (attempt !== undefined && task !== undefined) return { view, leadHostKey, task, attempt };
    }
  }

  return null;
};

/** The worker's latest Attempt, when this session is one (across every Host's graphs). */
export const useWorkerAttempt = (hostKey: string, sessionId: string): WorkerAttempt | null => {
  const select = useMemo(
    () => (s: AppState) => workerAttempt(s, hostKey, sessionId),
    [hostKey, sessionId]
  );

  return useStable(select, printWorker);
};

const printWorker = (w: WorkerAttempt | null) =>
  w === null ? "" : `${w.leadHostKey}|${w.view.sequence}|${w.attempt.id}|${w.attempt.revision}`;

const printFacts = (map: ReadonlyMap<string, WorkerFacts>) => JSON.stringify([...map]);

/** The rail's facts for one Constellation: worker liveness, receipts, the Lead's own context. */
export const useFacts = (record: ConstellationRecord | null): Facts => {
  const { store } = useConnection();
  const signals = useSignals();
  const now = useNow();
  const c = record?.constellation ?? null;

  const select = useMemo(
    () => (state: AppState) => {
      const map = new Map<string, WorkerFacts>();

      if (c === null) return map;
      const latest = new Map(c.attempts.map((a) => [a.taskId, a]));

      for (const a of latest.values()) map.set(a.id, workerFactsFrom(state, c, a, signals));

      return map;
    },
    [c, signals]
  );

  const workers = useStable(select, printFacts);
  const lead = useApp((s) => (c === null ? null : leadFactsOf(s, c.hostId, c.leadSessionId)));
  const leadContext = c === null ? undefined : signals.leadContext.get(c.leadSessionId);

  return useMemo(
    (): Facts => ({
      now,
      worker: (attempt) => workers.get(attempt.id) ?? NO_FACTS,
      receipt: (ref) => receiptFrom(store.getState(), ref, signals),
      handedUp: signals.handedUp,
      lead: {
        harness: lead?.harness ?? null,
        model: lead?.model ?? null,
        contextPercent: leadContext ?? lead?.context ?? null,
      },
    }),
    [now, workers, store, signals, lead, leadContext]
  );
};

const leadCache = new Map<
  string,
  { harness: string; model: string | null; context: number | null }
>();

const leadFactsOf = (state: AppState, hostId: string, sessionId: string) => {
  const hostKey = hostKeyOf(state.hosts, hostId);

  const session =
    hostKey === null ? null : (state.hostModels[hostKey]?.sessions.get(sessionId)?.session ?? null);

  if (session === null) return null;
  const usage = session.contextUsage;

  const context =
    usage === null || usage.windowTokens === null || usage.windowTokens <= 0
      ? null
      : Math.round((usage.usedTokens / usage.windowTokens) * 100);

  const prior = leadCache.get(sessionId);

  if (
    prior?.harness === session.harness &&
    prior.model === session.model &&
    prior.context === context
  )
    return prior;
  const next = { harness: session.harness, model: session.model, context };

  leadCache.set(sessionId, next);

  return next;
};

/** The Task the Lead's Intent column has focused, for the sidebar's selected worker row. */
export const useFocusedTask = (hostKey: string, leadSessionId: string): string | null => {
  const focus = useLeadUi(leadKey(hostKey, leadSessionId)).focus;

  return focus?.kind === "task" ? focus.taskId : null;
};

export interface FocusTarget {
  readonly hostKey: string;
  readonly leadSessionId: string;
}

const setFocus = ({ hostKey, leadSessionId }: FocusTarget, focus: Focus | null) =>
  patchLeadUi(leadKey(hostKey, leadSessionId), (ui) => ({
    focus,
    selected: focus?.kind === "task" ? `task:${focus.taskId}` : ui.selected,
  }));

/** Focus swaps for other features: select the Lead and show a worker, or the handover summary. */
export const useConstellationActions = () => {
  const { selectSession } = useShellActions();

  const select = (target: FocusTarget) =>
    // SAFETY: a Lead's id comes from Constellation.leadSessionId, itself a SessionId.
    selectSession({ hostKey: target.hostKey, sessionId: target.leadSessionId as SessionId });

  return {
    focusTask: (target: FocusTarget & { readonly taskId: string }) => {
      setFocus(target, { kind: "task", taskId: target.taskId });
      select(target);
    },
    openHandover: (target: FocusTarget & { readonly revision: number }) => {
      setFocus(target, { kind: "handover", revision: target.revision });
      select(target);
    },
    /** Back to the Lead's own conversation (the sidebar's Lead row). */
    unfocusTask: (target: FocusTarget) => setFocus(target, null),
  };
};

export { setFocus };

/** Swaps the Lead's Intent to a worker without selecting the Lead (callers select it). */
export const focusTask = (target: FocusTarget & { readonly taskId: string }) =>
  setFocus(target, { kind: "task", taskId: target.taskId });

/** Shows the Lead's own conversation again (the sidebar's Lead row). */
export const unfocusTask = (target: FocusTarget) => setFocus(target, null);
