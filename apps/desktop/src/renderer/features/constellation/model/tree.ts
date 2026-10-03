/**
 * Parent Tasks (DESIGN.md, Constellation (DAG) → Tree): who nests under whom, the deps a Task
 * inherits from its ancestors, and the group its root carries. Mirrors the Daemon's parents.ts.
 */
import type { TaskId } from "@polaris/protocol";

interface Node {
  readonly id: TaskId;
  readonly parent?: TaskId | null;
  readonly deps: ReadonlyArray<TaskId>;
  readonly group?: string | null;
  readonly canceled?: boolean;
}

/** A Task's ancestors, nearest first; stops at a missing parent or a cycle. */
export const ancestors = <T extends Node>(
  byId: ReadonlyMap<string, T>,
  id: string
): ReadonlyArray<T> => {
  const out: Array<T> = [];
  const seen = new Set<string>([id]);
  let next = byId.get(id)?.parent ?? null;

  while (next !== null && !seen.has(next)) {
    const node = byId.get(next);

    if (node === undefined) break;
    seen.add(next);
    out.push(node);
    next = node.parent ?? null;
  }

  return out;
};

/** Its own deps, then each ancestor's, without repeats. */
export const effectiveDeps = <T extends Node>(
  byId: ReadonlyMap<string, T>,
  task: T
): ReadonlyArray<TaskId> => [
  ...new Set([task, ...ancestors(byId, task.id)].flatMap((t) => t.deps)),
];

/** The group a Task sits in: its outermost ancestor's, so a subtree never splits across groups. */
export const rootGroup = <T extends Node>(byId: ReadonlyMap<string, T>, task: T) => {
  const group = (ancestors(byId, task.id).at(-1) ?? task).group;

  return group == null || group === "" ? null : group;
};

/** Each Task's children in declaration order (canceled ones included). */
export const childrenOf = <T extends Node>(tasks: ReadonlyArray<T>) => {
  const ids = new Set(tasks.map((t) => t.id));
  const out = new Map<TaskId, Array<T>>();

  for (const t of tasks) {
    const parent = t.parent ?? null;

    if (parent !== null && ids.has(parent)) out.set(parent, [...(out.get(parent) ?? []), t]);
  }

  return out;
};

/** A container rolls its children up; with only canceled children it is a leaf again. */
export const isContainer = <T extends Node>(children: ReadonlyArray<T> | undefined) =>
  children?.some((c) => c.canceled !== true) ?? false;
