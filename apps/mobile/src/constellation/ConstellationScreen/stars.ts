/**
 * A constellation as the star chart draws it (Paper MX-W, MX-X): bands from task groups, waves
 * from dependency depth, and each task labelled band letter plus its place in the band ("B3").
 */
import type { Task, TaskProjection } from "@polaris/protocol";
import type { StarBand, StarState, StarTask } from "../../starChart/index.ts";
import { type ConstellationSource, type Tone, taskRow } from "../model.ts";

/** The band ungrouped tasks share. */
export const UNGROUPED = "tasks";

const STATE_OF_TONE: Readonly<Record<Exclude<Tone, "ended">, StarState>> = {
  done: "done",
  working: "working",
  review: "review",
  "needs-you": "review",
  blocked: "blocked",
  failed: "failed",
  waiting: "waiting",
};

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** "A" to "Z", then "AA", "AB"… for a constellation with more bands than letters. */
export const bandLetter = (index: number): string =>
  index < LETTERS.length
    ? (LETTERS[index] ?? "")
    : `${bandLetter(Math.floor(index / LETTERS.length) - 1)}${LETTERS[index % LETTERS.length] ?? ""}`;

/** 1 for a task with no charted dependencies, else one past its deepest dependency. */
const wavesOf = (tasks: ReadonlyArray<Task>): ReadonlyMap<string, number> => {
  const byId = new Map<string, Task>(tasks.map((t) => [t.id, t]));
  const waves = new Map<string, number>();
  const visiting = new Set<string>();

  const wave = (id: string): number => {
    const known = waves.get(id);

    if (known !== undefined) return known;
    const t = byId.get(id);

    // A dependency off the chart, or a cycle, adds no depth.
    if (t === undefined || visiting.has(id)) return 0;
    visiting.add(id);
    const depth = 1 + Math.max(0, ...t.deps.map(wave));

    visiting.delete(id);
    waves.set(id, depth);

    return depth;
  };

  for (const t of tasks) wave(t.id);

  return waves;
};

export interface StarChartData {
  readonly tasks: ReadonlyArray<StarTask>;
  readonly bands: ReadonlyArray<StarBand>;
}

/** The tasks a chart shows: parents, canceled and lost tasks are left out, as in the task bar. */
const charted = (source: ConstellationSource) => {
  const { constellation: c } = source;
  const projections = new Map<string, TaskProjection>(source.projections.map((p) => [p.taskId, p]));
  const parents = new Set<string>(c.tasks.flatMap((t) => (t.parent == null ? [] : [t.parent])));

  return c.tasks.flatMap((t) => {
    if (parents.has(t.id)) return [];
    const row = taskRow(c, t, projections, 0);

    return row === null || row.tone === "ended"
      ? []
      : [{ task: t, state: STATE_OF_TONE[row.tone] }];
  });
};

const bandsOf = (tasks: ReadonlyArray<Task>): ReadonlyArray<StarBand> => {
  const names = [...new Set(tasks.map((t) => t.group ?? UNGROUPED))];

  return names.map((name, i) => ({ id: name, letter: bandLetter(i), name }));
};

/** The chart's bands and stars, in band order and then by wave and declaration. */
export const starChartOf = (source: ConstellationSource): StarChartData => {
  const shown = charted(source);
  const tasks = shown.map((s) => s.task);
  const bands = bandsOf(tasks);
  const waves = wavesOf(tasks);
  const order = new Map<string, number>(tasks.map((t, i) => [t.id, i]));

  const stars = bands.flatMap((band) =>
    shown
      .filter((s) => (s.task.group ?? UNGROUPED) === band.id)
      .sort(
        (a, b) =>
          (waves.get(a.task.id) ?? 1) - (waves.get(b.task.id) ?? 1) ||
          (order.get(a.task.id) ?? 0) - (order.get(b.task.id) ?? 0)
      )
      .map((s, i) => ({
        id: s.task.id,
        label: `${band.letter}${i + 1}`,
        band: band.id,
        wave: waves.get(s.task.id) ?? 1,
        state: s.state,
        dependsOn: s.task.deps,
      }))
  );

  return { tasks: stars, bands };
};
