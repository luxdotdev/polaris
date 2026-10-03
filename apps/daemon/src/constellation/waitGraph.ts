import type { Attempt, Task, TaskId } from "@polaris/protocol";
import { childTasks, effectiveDeps, prerequisites } from "./parents.ts";

interface WaitEdge {
  readonly target: TaskId;
  readonly block: boolean;
}

const completedTasks = (tasks: ReadonlyArray<Task>, attempts: ReadonlyArray<Attempt>) => {
  const children = new Map(
    tasks.map((t) => [t.id, childTasks(tasks, t.id).filter((c) => !c.canceled)])
  );

  const latest = new Map(attempts.map((a) => [a.taskId, a]));

  const done = new Set(
    tasks.flatMap((t) =>
      !t.canceled && children.get(t.id)?.length === 0 && latest.get(t.id)?.state === "accepted"
        ? [t.id]
        : []
    )
  );

  // Candidate parent/dependency cycles are not trusted until Plan validation succeeds.
  for (let i = 0; i < tasks.length; i++) {
    const before = done.size;

    for (const task of tasks) {
      const kids = children.get(task.id) ?? [];

      if (
        !task.canceled &&
        kids.length > 0 &&
        kids.every((child) => done.has(child.id)) &&
        effectiveDeps(tasks, task.id).every((dep) => done.has(dep))
      )
        done.add(task.id);
    }

    if (done.size === before) break;
  }

  return done;
};

/** Completion prerequisites and live blocks share one graph for deadlock checks. */
export const waitGraph = (tasks: ReadonlyArray<Task>, attempts: ReadonlyArray<Attempt>) => {
  const done = completedTasks(tasks, attempts);
  const live = new Set(tasks.flatMap((t) => (t.canceled || done.has(t.id) ? [] : [t.id])));

  const edges = new Map<TaskId, Array<WaitEdge>>(
    tasks.map((task) => [
      task.id,
      live.has(task.id)
        ? prerequisites(tasks, task.id)
            .filter((target) => live.has(target))
            .map((target) => ({ target, block: false }))
        : [],
    ])
  );

  for (const attempt of attempts) {
    if (attempt.state !== "blocked" || !live.has(attempt.taskId)) continue;

    for (const target of attempt.blockedOn)
      if (live.has(target)) edges.get(attempt.taskId)?.push({ target, block: true });
  }

  return edges;
};

export const waitClosure = (edges: ReturnType<typeof waitGraph>, id: TaskId) => {
  const pending = [id];
  const seen = new Set<TaskId>();

  while (pending.length > 0) {
    const next = pending.pop();

    if (next === undefined || seen.has(next)) continue;
    seen.add(next);
    pending.push(...(edges.get(next) ?? []).map((edge) => edge.target));
  }

  return seen;
};

export const waitCycleMessage = (
  edges: ReturnType<typeof waitGraph>,
  cycle: ReadonlyArray<TaskId>
) => {
  const blocks = cycle.flatMap((from, i) => {
    const to = cycle[i + 1];

    return edges.get(from)?.some((edge) => edge.target === to && edge.block)
      ? [`block ${from} → ${to}`]
      : [];
  });

  return `Dependency cycle: ${cycle.join(" → ")}${blocks.length === 0 ? "" : ` (${blocks.join("; ")})`}`;
};

export const waitPath = (edges: ReturnType<typeof waitGraph>, from: TaskId, to: TaskId) => {
  const pending = [[from]];
  const seen = new Set<TaskId>();

  while (pending.length > 0) {
    const path = pending.pop()!;
    const next = path.at(-1)!;

    if (next === to) return path;

    if (seen.has(next)) continue;
    seen.add(next);

    for (const edge of edges.get(next) ?? []) pending.push([...path, edge.target]);
  }

  return null;
};
