/**
 * Task projections derived from the graph, as the decider defines them (spec §2): a Task's
 * state follows its latest Attempt. Stale and fetched flags come only from the Daemon.
 */
import type { AttemptState, TaskId, TaskState } from "@polaris/protocol";
import { childrenOf, effectiveDeps, isContainer } from "./tree.ts";
import type { AttemptData, ConstellationData, ProjectionData, TaskData } from "./types.ts";

const FROM_ATTEMPT: Readonly<Record<AttemptState, TaskState>> = {
  working: "working",
  blocked: "blocked",
  review: "review",
  accepted: "done",
  rejected: "ready",
  lost: "lost",
  failed: "failed",
};

/** Each Task's latest Attempt (the last one started). */
export const latestAttempts = (c: ConstellationData): ReadonlyMap<TaskId, AttemptData> =>
  new Map(c.attempts.map((a) => [a.taskId, a]));

const unfinishedDeps = (deps: ReadonlyArray<TaskId>, done: ReadonlySet<TaskId>) =>
  deps.filter((dep) => !done.has(dep));

const ACTIVE: ReadonlySet<TaskState> = new Set(["working", "review", "blocked"]);

/** A container's state from its live children, as the Daemon's `parentState`. */
const rollup = (children: ReadonlyArray<ProjectionData>, blocked: boolean): TaskState => {
  const live = children.filter((child) => child.state !== "canceled");

  if (live.some((child) => ACTIVE.has(child.state))) return "working";

  if (blocked) return "waiting";

  if (live.every((child) => child.state === "done")) return "done";

  return live.some((child) => child.state === "ready") ? "ready" : "waiting";
};

/** Accepted Tasks; a container counts once its inherited deps and live children are. */
const acceptedTasks = (
  c: ConstellationData,
  latest: ReadonlyMap<TaskId, AttemptData>,
  kids: ReadonlyMap<TaskId, ReadonlyArray<TaskData>>
) => {
  const byId = new Map(c.tasks.map((t) => [t.id, t]));
  const memo = new Map<TaskId, boolean>();

  const accepted = (task: TaskData): boolean => {
    const known = memo.get(task.id);

    if (known !== undefined) return known;
    memo.set(task.id, false);
    const live = (kids.get(task.id) ?? []).filter((child) => !child.canceled);

    const result =
      !task.canceled &&
      (live.length === 0
        ? latest.get(task.id)?.state === "accepted"
        : effectiveDeps(byId, task).every((dep) => {
            const t = byId.get(dep);

            return t !== undefined && accepted(t);
          }) && live.every(accepted));

    memo.set(task.id, result);

    return result;
  };

  return new Set(c.tasks.filter(accepted).map((t) => t.id));
};

/**
 * Projections for every Task. `known` (the Daemon's last ones) keeps stale, fetched and
 * liveness, which only the Daemon can tell.
 */
export const deriveProjections = (
  c: ConstellationData,
  known: ReadonlyArray<ProjectionData> = []
): ReadonlyArray<ProjectionData> => {
  const latest = latestAttempts(c);
  const prior = new Map(known.map((p) => [p.taskId, p]));

  const kids = childrenOf(c.tasks);
  const byId = new Map(c.tasks.map((t) => [t.id, t]));
  const done = acceptedTasks(c, latest, kids);
  const projected = new Map<TaskId, ProjectionData>();

  const project = (task: TaskData): ProjectionData => {
    const cached = projected.get(task.id);

    if (cached !== undefined) return cached;
    const attempt = latest.get(task.id) ?? null;
    const was = prior.get(task.id);
    const children = kids.get(task.id) ?? [];

    const blockedBy = unfinishedDeps(
      [
        ...new Set([
          ...effectiveDeps(byId, task),
          ...(attempt?.state === "blocked" ? attempt.blockedOn : []),
        ]),
      ],
      done
    );

    const unstarted: TaskState = blockedBy.length > 0 ? "waiting" : "ready";

    const leaf: TaskState =
      attempt === null || attempt.state === "rejected" ? unstarted : FROM_ATTEMPT[attempt.state];

    const state: TaskState = task.canceled
      ? "canceled"
      : isContainer(children)
        ? rollup(children.map(project), blockedBy.length > 0)
        : leaf;

    const projection: ProjectionData = {
      taskId: task.id,
      state,
      latestAttemptId: attempt?.id ?? null,
      blockedBy,
      children: children.map((child) => child.id),
      gatePromoted: task.kind === "gate" && blockedBy.length === 0 && task.deps.length > 0,
      stale: attempt !== null && was?.latestAttemptId === attempt.id ? was.stale : false,
      branchFetched: was?.branchFetched ?? true,
      liveness: attempt !== null && was?.latestAttemptId === attempt.id ? was.liveness : null,
    };

    projected.set(task.id, projection);

    return projection;
  };

  return c.tasks.map(project);
};
