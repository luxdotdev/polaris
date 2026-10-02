import {
  type Attempt,
  type Constellation,
  type Task,
  TaskProjection,
  type AttemptId,
  type WorkerLiveness,
} from "@polaris/protocol";
import { Match } from "effect";
import type { ConstellationRecord } from "../store/constellation.ts";

export const latestAttempt = (graph: Constellation, taskId: Task["id"]) =>
  graph.attempts.findLast((attempt) => attempt.taskId === taskId);

export const activeAttempt = (attempt: Attempt) =>
  attempt.state === "working" || attempt.state === "review";

export const accepted = (graph: Constellation, taskId: Task["id"]) =>
  latestAttempt(graph, taskId)?.state === "accepted";

export interface ProjectionObservations {
  readonly offlineHosts?: ReadonlySet<Attempt["hostId"]>;
  readonly fetchedAttempts?: ReadonlySet<Attempt["id"]>;
}

/** Dependency acceptance and the latest Attempt determine Task state; Host staleness never settles it. */
export const projectTask = (
  record: ConstellationRecord,
  task: Task,
  observations: ProjectionObservations = {}
): TaskProjection => {
  const attempt = latestAttempt(record.graph, task.id);
  const blockedBy = task.deps.filter((id) => !accepted(record.graph, id));
  const available = blockedBy.length === 0 ? "ready" : "waiting";

  const state = task.canceled
    ? "canceled"
    : attempt === undefined
      ? available
      : Match.value(attempt.state).pipe(
          Match.when("accepted", () => "done" as const),
          Match.when("rejected", () => available),
          Match.when("working", () => "working" as const),
          Match.when("review", () => "review" as const),
          Match.when("lost", () => "lost" as const),
          Match.when("failed", () => "failed" as const),
          Match.when("settled_unverified", () => "settled_unverified" as const),
          Match.exhaustive
        );

  return new TaskProjection({
    taskId: task.id,
    state,
    latestAttemptId: attempt?.id ?? null,
    blockedBy,
    gatePromoted: record.promoted.has(task.id),
    liveness: null,
    stale: attempt !== undefined && observations.offlineHosts?.has(attempt.hostId) === true,
    branchFetched:
      attempt === undefined ||
      attempt.hostId === record.graph.hostId ||
      observations.fetchedAttempts?.has(attempt.id) === true,
  });
};

export const projectTasks = (record: ConstellationRecord, observations?: ProjectionObservations) =>
  record.graph.tasks.map((task) => projectTask(record, task, observations));

/** Runtime-only enrichment; pure graph decisions leave observational liveness unknown. */
export const enrichProjections = (
  record: ConstellationRecord,
  facts: ReadonlyMap<AttemptId, WorkerLiveness>,
  observations?: ProjectionObservations
) =>
  projectTasks(record, observations).map(
    (p) =>
      new TaskProjection({
        taskId: p.taskId,
        state: p.state,
        latestAttemptId: p.latestAttemptId,
        blockedBy: p.blockedBy,
        gatePromoted: p.gatePromoted,
        stale: p.stale,
        branchFetched: p.branchFetched,
        liveness: p.latestAttemptId === null ? null : (facts.get(p.latestAttemptId) ?? null),
      })
  );
