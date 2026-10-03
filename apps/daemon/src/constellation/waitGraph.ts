import type { Attempt, Task, TaskId } from "@polaris/protocol";
import { prerequisites } from "./parents.ts";

interface WaitEdge {
  readonly target: TaskId;
  readonly block: boolean;
}

/** Completion prerequisites and live blocks share one graph for deadlock checks. */
export const waitGraph = (tasks: ReadonlyArray<Task>, attempts: ReadonlyArray<Attempt>) => {
  const live = new Set(tasks.flatMap((t) => (t.canceled ? [] : [t.id])));

  const edges = new Map<TaskId, Array<WaitEdge>>(
    tasks.map((task) => [
      task.id,
      prerequisites(tasks, task.id).map((target) => ({ target, block: false })),
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
