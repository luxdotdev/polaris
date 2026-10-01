/**
 * Task projections derived from the graph, as the decider defines them (spec §2): a Task's
 * state follows its latest Attempt. Stale and fetched flags come only from the Daemon.
 */
import type { AttemptState, TaskId, TaskState } from "@polaris/protocol";
import type { AttemptData, ConstellationData, ProjectionData } from "./types.ts";

const FROM_ATTEMPT: Readonly<Record<AttemptState, TaskState>> = {
  working: "working",
  review: "review",
  accepted: "done",
  rejected: "ready",
  lost: "lost",
  settled_unverified: "settled_unverified",
  failed: "failed",
};

/** Each Task's latest Attempt (the last one started). */
export const latestAttempts = (c: ConstellationData): ReadonlyMap<TaskId, AttemptData> =>
  new Map(c.attempts.map((a) => [a.taskId, a]));

const unfinishedDeps = (deps: ReadonlyArray<TaskId>, done: ReadonlySet<TaskId>) =>
  deps.filter((dep) => !done.has(dep));

/**
 * Projections for every Task. `known` (the Daemon's last ones) keeps stale, fetched and
 * future, which only the Daemon can tell.
 */
export const deriveProjections = (
  c: ConstellationData,
  known: ReadonlyArray<ProjectionData> = []
): ReadonlyArray<ProjectionData> => {
  const latest = latestAttempts(c);
  const prior = new Map(known.map((p) => [p.taskId, p]));

  const done = new Set(
    c.tasks.filter((t) => latest.get(t.id)?.state === "accepted").map((t) => t.id)
  );

  return c.tasks.map((task): ProjectionData => {
    const attempt = latest.get(task.id) ?? null;
    const was = prior.get(task.id);
    const blockedBy = unfinishedDeps(task.deps, done);

    const waiting: TaskState = was?.state === "future" ? "future" : "waiting";
    const unstarted: TaskState = blockedBy.length > 0 ? waiting : "ready";

    const state: TaskState = task.canceled
      ? "canceled"
      : attempt === null
        ? unstarted
        : FROM_ATTEMPT[attempt.state];

    return {
      taskId: task.id,
      state,
      latestAttemptId: attempt?.id ?? null,
      blockedBy,
      gatePromoted: task.kind === "gate" && blockedBy.length === 0 && task.deps.length > 0,
      stale: was?.stale ?? false,
      branchFetched: was?.branchFetched ?? true,
      liveness: attempt !== null && was?.latestAttemptId === attempt.id ? was.liveness : null,
    };
  });
};
