/**
 * Stand-in for `features/constellation`'s read model (C1-U1 owns it): the same names and
 * shapes, fed only by preview fakes until that slice lands; then this file re-exports it.
 */
import type {
  Attempt,
  Constellation,
  SessionId,
  Task,
  TaskId,
  TaskProjection,
} from "@polaris/protocol";
import { useMemo } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Plain } from "../../store/plain.ts";

export interface ConstellationView {
  readonly constellation: Plain<Constellation>;
  readonly projections: ReadonlyArray<Plain<TaskProjection>>;
}

export interface WorkerAttempt {
  readonly view: ConstellationView;
  readonly task: Plain<Task>;
  readonly attempt: Plain<Attempt>;
}

interface SourceState {
  /** By Host key: the Constellations whose stream lives on that Host (the Lead's). */
  readonly byHost: Readonly<Record<string, ReadonlyArray<ConstellationView>>>;
  /** The Task each Lead's view has swapped in, by `hostKey\0leadSessionId`. */
  readonly focused: Readonly<Record<string, TaskId>>;
}

export const constellationSource = createStore<SourceState>(() => ({ byHost: {}, focused: {} }));

const NONE: ReadonlyArray<ConstellationView> = [];

const focusKey = (hostKey: string, leadSessionId: string) => `${hostKey}\u0000${leadSessionId}`;

export const useConstellations = (hostKey: string | null): ReadonlyArray<ConstellationView> =>
  useStore(constellationSource, (s) => (hostKey === null ? NONE : (s.byHost[hostKey] ?? NONE)));

/** Every Host's Constellations, for views across Hosts (Needs you, Usage). */
export const useAllConstellations = (): Readonly<
  Record<string, ReadonlyArray<ConstellationView>>
> => useStore(constellationSource, (s) => s.byHost);

export const useLeadConstellation = (
  hostKey: string,
  leadSessionId: SessionId
): ConstellationView | null =>
  useStore(
    constellationSource,
    (s) =>
      (s.byHost[hostKey] ?? NONE).find(
        (v) =>
          v.constellation.leadSessionId === leadSessionId && v.constellation.state !== "archived"
      ) ?? null
  );

/** The worker's latest Attempt, wherever its Constellation lives. */
export const workerAttemptIn = (
  byHost: SourceState["byHost"],
  sessionId: string
): WorkerAttempt | null => {
  for (const views of Object.values(byHost)) {
    for (const view of views) {
      const attempt = view.constellation.attempts.findLast((a) => a.sessionId === sessionId);
      const task = view.constellation.tasks.find((t) => t.id === attempt?.taskId);

      if (attempt !== undefined && task !== undefined) return { view, task, attempt };
    }
  }

  return null;
};

export const useWorkerAttempt = (_hostKey: string, sessionId: SessionId): WorkerAttempt | null => {
  const byHost = useStore(constellationSource, (s) => s.byHost);

  return useMemo(() => workerAttemptIn(byHost, sessionId), [byHost, sessionId]);
};

export const useFocusedTask = (hostKey: string, leadSessionId: string): TaskId | null =>
  useStore(constellationSource, (s) => s.focused[focusKey(hostKey, leadSessionId)] ?? null);

/** Swaps the Lead's Intent to the worker (U1 owns the swap); callers select the Lead first. */
export const focusTask = (target: {
  readonly hostKey: string;
  readonly leadSessionId: SessionId;
  readonly taskId: TaskId;
}) =>
  constellationSource.setState((s) => ({
    focused: { ...s.focused, [focusKey(target.hostKey, target.leadSessionId)]: target.taskId },
  }));

/** Shows the Lead's own conversation again (the Lead row in the sidebar). */
export const unfocusTask = (target: {
  readonly hostKey: string;
  readonly leadSessionId: SessionId;
}) =>
  constellationSource.setState((s) => {
    const { [focusKey(target.hostKey, target.leadSessionId)]: _, ...focused } = s.focused;

    return { focused };
  });

/** U1's actions hook: focus a worker, show the Lead again, open the handover record. */
export const useConstellationActions = () => ({
  focusTask,
  unfocusTask,
  openHandover: (_target: { readonly hostKey: string; readonly leadSessionId: SessionId }) =>
    undefined,
});
