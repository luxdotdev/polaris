import type { Constellation, Task, TaskId } from "@polaris/protocol";
import type { GraphDecision } from "./decision.ts";

export const childTasks = (tasks: ReadonlyArray<Task>, id: TaskId) =>
  tasks.filter((task) => task.parent === id);

export const isParent = (graph: Constellation, id: TaskId) =>
  graph.tasks.some((task) => task.parent === id && !task.canceled);

export const ancestors = (tasks: ReadonlyArray<Task>, id: TaskId): ReadonlySet<TaskId> => {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const result = new Set<TaskId>();
  let parent = byId.get(id)?.parent;

  while (parent != null && !result.has(parent)) {
    result.add(parent);
    parent = byId.get(parent)?.parent;
  }

  return result;
};

const validateContainer = (d: GraphDecision, tasks: ReadonlyArray<Task>, task: Task) => {
  if (!childTasks(tasks, task.id).some((child) => !child.canceled)) return;

  if (task.kind === "gate")
    d.reject(
      "E-PARENT-GATE",
      `Gate ${task.id} cannot be a parent`,
      "Use a task container and a separate Gate."
    );

  if (d.record.graph.attempts.some((attempt) => attempt.taskId === task.id))
    d.reject(
      "E-PARENT-STARTED",
      `${task.id} already has an Attempt`,
      "Choose a parent that has never had an Attempt."
    );
};

const validateAncestryDeps = (
  d: GraphDecision,
  task: Task,
  lineage: ReadonlyMap<TaskId, ReadonlySet<TaskId>>
) => {
  for (const dep of task.deps)
    if (lineage.get(task.id)?.has(dep) || lineage.get(dep)?.has(task.id))
      d.reject(
        "E-DEP-ANCESTOR",
        `${task.id} and dependency ${dep} are ancestor and descendant`,
        "Depend on a sibling Task or a separate Gate."
      );
};

export const validateParents = (d: GraphDecision, tasks: ReadonlyArray<Task>) => {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const lineage = new Map(tasks.map((task) => [task.id, ancestors(tasks, task.id)]));

  for (const task of tasks) {
    if (task.parent !== null && !byId.has(task.parent))
      d.reject(
        "E-PARENT-UNKNOWN",
        `${task.id} has unknown parent ${task.parent}`,
        "Add the parent or remove the parent field."
      );

    if (lineage.get(task.id)?.has(task.id))
      d.reject(
        "E-PARENT-CYCLE",
        `Parent cycle includes ${task.id}`,
        "Move a Task out of this parent cycle."
      );

    if (task.canceled) continue;

    if (task.parent !== null && byId.get(task.parent)?.canceled)
      d.reject(
        "E-CANCEL-DEPENDENTS",
        `${task.id} is under canceled parent ${task.parent}`,
        "Move or cancel the child in the same batch."
      );
    validateContainer(d, tasks, task);
    validateAncestryDeps(d, task, lineage);
  }
};

/** Cancel the final batch's subtree, preserving the active Attempt guard on every descendant. */
export const cancelSubtrees = (
  d: GraphDecision,
  candidate: Map<TaskId, Task>,
  roots: ReadonlySet<TaskId>
) => {
  const tasks = [...candidate.values()];
  const canceled: Array<Task> = [];

  for (const task of tasks) {
    if (!roots.has(task.id) && ![...ancestors(tasks, task.id)].some((id) => roots.has(id)))
      continue;

    if (task.canceled) continue;
    const attempt = d.record.graph.attempts.findLast((a) => a.taskId === task.id);

    if (attempt !== undefined && ["working", "review", "blocked"].includes(attempt.state))
      d.reject(
        "E-TASK-ACTIVE",
        `Task ${task.id} has active Attempt ${attempt.id}`,
        "Stop its Attempt before canceling the parent."
      );
    canceled.push(task);
  }

  return canceled;
};

export const completionTasks = (tasks: ReadonlyArray<Task>, id: TaskId): ReadonlyArray<Task> => {
  const task = tasks.find((t) => t.id === id);

  if (task === undefined || task.canceled) return [];
  const children = childTasks(tasks, id).filter((child) => !child.canceled);

  return children.length === 0
    ? [task]
    : children.flatMap((child) => completionTasks(tasks, child.id));
};

export const acceptedDependencyClaims = (graph: Constellation, deps: ReadonlyArray<TaskId>) => {
  const ids = new Set(
    deps.flatMap((id) => completionTasks(graph.tasks, id).map((task) => task.id))
  );

  return graph.attempts.flatMap((attempt) =>
    attempt.state === "accepted" && attempt.claim !== null && ids.has(attempt.taskId)
      ? [{ taskId: attempt.taskId, claim: attempt.claim }]
      : []
  );
};
