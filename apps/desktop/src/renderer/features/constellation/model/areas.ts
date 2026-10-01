/**
 * Area overlaps (spec §2): a Task whose Area could touch the same paths as a working Attempt's
 * warns the Lead. Two globs overlap when one's literal prefix contains the other's.
 */
import type { TaskId } from "@polaris/protocol";
import type { ProjectionData, TaskData } from "./types.ts";

export interface Overlap {
  readonly with: TaskId;
  /** This Task's glob that overlaps. */
  readonly glob: string;
}

/** The part of a glob before its first wildcard, without a trailing partial segment. */
const literal = (glob: string) => {
  const cut = glob.search(/[*?[{]/);

  return cut === -1 ? glob : glob.slice(0, cut);
};

export const globsOverlap = (a: string, b: string) => {
  const x = literal(a);
  const y = literal(b);

  return x.startsWith(y) || y.startsWith(x);
};

const ACTIVE = new Set(["working", "review", "ready"]);

/** Each live Task's first overlap with an earlier-declared working Task, so a pair warns once. */
export const areaOverlaps = (
  tasks: ReadonlyArray<TaskData>,
  projections: ReadonlyMap<TaskId, ProjectionData>
): ReadonlyMap<TaskId, Overlap> => {
  const working = tasks.filter(
    (t) => projections.get(t.id)?.state === "working" && t.area.length > 0
  );

  const found = new Map<TaskId, Overlap>();

  const order = new Map(tasks.map((t, i) => [t.id, i]));

  for (const task of tasks) {
    if (!ACTIVE.has(projections.get(task.id)?.state ?? "")) continue;
    const at = order.get(task.id) ?? 0;

    for (const other of working) {
      if ((order.get(other.id) ?? 0) >= at) continue;
      const glob = task.area.find((g) => other.area.some((o) => globsOverlap(g, o)));

      if (glob !== undefined) {
        found.set(task.id, { with: other.id, glob });
        break;
      }
    }
  }

  return found;
};
