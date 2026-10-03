import {
  type Attempt,
  type Constellation,
  type Task,
  TaskProjection,
  type AttemptId,
  type WorkerLiveness,
} from "@polaris/protocol";
import { Match } from "effect";
import { childTasks } from "./parents.ts";
import type { ConstellationRecord } from "../store/constellation.ts";

export const latestAttempt = (graph: Constellation, taskId: Task["id"]) =>
  graph.attempts.findLast((attempt) => attempt.taskId === taskId);

export const activeAttempt = (attempt: Attempt) =>
  attempt.state === "working" || attempt.state === "review";

export const accepted = (graph: Constellation, taskId: Task["id"]): boolean => {
  const task = graph.tasks.find((t) => t.id === taskId);

  if (task === undefined || task.canceled) return false;
  const children = childTasks(graph.tasks, taskId).filter((child) => !child.canceled);

  return children.length > 0
    ? children.every((child) => accepted(graph, child.id))
    : latestAttempt(graph, taskId)?.state === "accepted";
};

const parentState = (children: ReadonlyArray<TaskProjection>): TaskProjection["state"] => {
  const live = children.filter((child) => child.state !== "canceled");

  if (live.every((child) => child.state === "done")) return "done";

  if (live.some((child) => ["working", "review", "blocked"].includes(child.state)))
    return "working";

  if (live.some((child) => child.state === "ready")) return "ready";

  return "waiting";
};

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

  const children = childTasks(record.graph.tasks, task.id);
  const container = children.some((child) => !child.canceled);

  const state = task.canceled
    ? "canceled"
    : container
      ? parentState(children.map((child) => projectTask(record, child, observations)))
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
    children: children.map((child) => child.id),
    gatePromoted: record.promoted.has(task.id),
    liveness: null,
    stale:
      attempt !== undefined &&
      (record.stale.has(attempt.id) || observations.offlineHosts?.has(attempt.hostId) === true),
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
        children: p.children,
        gatePromoted: p.gatePromoted,
        stale: p.stale,
        branchFetched: p.branchFetched,
        liveness: p.latestAttemptId === null ? null : (facts.get(p.latestAttemptId) ?? null),
      })
  );
