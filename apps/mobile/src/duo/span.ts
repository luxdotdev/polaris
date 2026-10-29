/**
 * The unfolded Duo's constellation span (Paper MX-AG): the star chart across the first half and
 * the chosen task's claim in the second. Pure; `ConstellationSpan` draws it.
 */
import type { CheckReceipt, Constellation, TaskProjection } from "@polaris/protocol";
import { Match } from "effect";
import { shortSha, elapsed } from "../constellation/copy.ts";
import { type Check, type Tone, taskRow, type TaskRow } from "../constellation/model.ts";
import { harnessName } from "../home/model/format.ts";
import { taskCode } from "../starChart/layout.ts";
import type { StarBand, StarState, StarTask } from "../starChart/types.ts";

/** Each task's dependency depth among the given ones; a dependency outside them counts as none. */
export const depths = (
  tasks: ReadonlyArray<{ readonly id: string; readonly deps: ReadonlyArray<string> }>
): ReadonlyMap<string, number> => {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const memo = new Map<string, number>();

  const depth = (id: string, seen: ReadonlySet<string>): number => {
    const known = memo.get(id);

    if (known !== undefined) return known;
    const deps = (byId.get(id)?.deps ?? []).filter((d) => byId.has(d) && !seen.has(d));
    const next = new Set(seen).add(id);
    const value = deps.length === 0 ? 0 : 1 + Math.max(...deps.map((d) => depth(d, next)));
    memo.set(id, value);

    return value;
  };

  for (const task of tasks) depth(task.id, new Set());

  return memo;
};

const starState = (tone: Tone): StarState =>
  Match.value(tone).pipe(
    Match.whenOr("needs-you", "review", () => "review" as const),
    Match.when("done", () => "done" as const),
    Match.when("working", () => "working" as const),
    Match.when("blocked", () => "blocked" as const),
    Match.when("failed", () => "failed" as const),
    Match.orElse(() => "waiting" as const)
  );

/** The tasks the chart shows: no parents, nothing canceled or lost, each with its row. */
export const chartRows = (
  c: Constellation,
  projections: ReadonlyArray<TaskProjection>,
  now: number
): ReadonlyArray<{ readonly row: TaskRow; readonly deps: ReadonlyArray<string> }> => {
  const byTask = new Map(projections.map((p) => [p.taskId, p]));
  const parents = new Set(c.tasks.flatMap((t) => (t.parent == null ? [] : [t.parent])));

  return c.tasks.flatMap((task) => {
    if (parents.has(task.id)) return [];
    const row = taskRow(c, task, byTask, now);

    return row === null || row.tone === "ended" ? [] : [{ row, deps: task.deps }];
  });
};

export interface SpanChart {
  readonly tasks: ReadonlyArray<StarTask>;
  readonly bands: ReadonlyArray<StarBand>;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** No group: one band, in the slot where its first task appears. */
const UNGROUPED = "tasks";

/**
 * Bands by group in first-seen order, lettered A, B, C…; the wave is the dependency depth plus one;
 * a task's label is its band letter and its place in the band by wave ("B3"), as the header's.
 */
export const spanChart = (
  c: Constellation,
  rows: ReadonlyArray<{ readonly row: TaskRow; readonly deps: ReadonlyArray<string> }>
): SpanChart => {
  const groupOf = new Map<string, string>(c.tasks.map((t) => [t.id, t.group ?? UNGROUPED]));
  const depthOf = depths(rows.map((r) => ({ id: r.row.id, deps: r.deps })));
  const bandIds = [...new Set(rows.map((r) => groupOf.get(r.row.id) ?? UNGROUPED))];

  const bands = bandIds.map((id, index) => ({
    id,
    letter: LETTERS[index % LETTERS.length] ?? "?",
    name: id,
  }));

  const letterOf = new Map(bands.map((b) => [b.id, b.letter]));
  const waveOf = (id: string) => (depthOf.get(id) ?? 0) + 1;

  const shown = new Set(rows.map((r) => r.row.id));

  const tasks = bandIds.flatMap((band) =>
    rows
      .flatMap((r, order) =>
        (groupOf.get(r.row.id) ?? UNGROUPED) === band ? [{ ...r, order }] : []
      )
      .sort((a, b) => waveOf(a.row.id) - waveOf(b.row.id) || a.order - b.order)
      .map((r, index): StarTask => ({
        id: r.row.id,
        label: `${letterOf.get(band) ?? "?"}${index + 1}`,
        band,
        wave: waveOf(r.row.id),
        state: starState(r.row.tone),
        dependsOn: r.deps.filter((d) => shown.has(d)),
      }))
  );

  const order = new Map(rows.map((r, index) => [r.row.id, index]));

  return {
    bands,
    tasks: [...tasks].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
  };
};

const count = (rows: ReadonlyArray<TaskRow>, tones: ReadonlyArray<Tone>) =>
  rows.filter((r) => tones.includes(r.tone)).length;

/** "5 of 12 done" and "2 working · 2 claims to review · 3 waiting", leaving out the zeros. */
export const spanSummary = (rows: ReadonlyArray<TaskRow>) => {
  const review = count(rows, ["needs-you", "review"]);

  const rest = [
    [count(rows, ["working"]), "working"],
    [review, review === 1 ? "claim to review" : "claims to review"],
    [count(rows, ["blocked"]), "blocked"],
    [count(rows, ["failed"]), "failed"],
    [count(rows, ["waiting"]), "waiting"],
  ] as const;

  return {
    done: `${count(rows, ["done"])} of ${rows.length} done`,
    line: rest.flatMap(([n, word]) => (n > 0 ? [`${n} ${word}`] : [])).join(" · "),
  };
};

/** The task the pane opens on: the first claim handed to you, else one in review, else working. */
export const firstChosen = (rows: ReadonlyArray<TaskRow>): string | null =>
  (
    rows.find((r) => r.handed !== null) ??
    rows.find((r) => r.tone === "needs-you" || r.tone === "review") ??
    rows.find((r) => r.tone === "working")
  )?.id ?? null;

export type PillTone = "needs-you" | "failed" | "quiet";

export interface ClaimPane {
  /** "Task B3 · wave 3", in the chart's own code. */
  readonly kicker: string;
  readonly pill: { readonly text: string; readonly tone: PillTone };
  readonly title: string;
  /** "attempt 2 · Codex · 18m". */
  readonly meta: string;
  readonly claim: {
    readonly summary: string;
    readonly checks: ReadonlyArray<Check>;
    /** "head 4c19e2a · 3 commits". */
    readonly head: string;
  } | null;
  /** Other claims handed to you, in order, for "C3 has a claim waiting too". */
  readonly others: ReadonlyArray<{ readonly id: string; readonly label: string }>;
}

const pillOf = (row: TaskRow): ClaimPane["pill"] => {
  if (row.handed !== null) return { text: "Claim ready", tone: "needs-you" };

  const text = `${row.word.charAt(0).toUpperCase()}${row.word.slice(1)}`;

  if (row.tone === "needs-you") return { text, tone: "needs-you" };

  return { text, tone: row.tone === "failed" || row.tone === "blocked" ? "failed" : "quiet" };
};

const reported = (exitCode: number | null | undefined): Check["result"] => {
  if (exitCode == null) return "reported";

  return exitCode === 0 ? "passed" : "failed";
};

const checkOf = (receipt: CheckReceipt): Check =>
  Match.value(receipt).pipe(
    Match.tag("Verified", (r) => ({ label: r.label, result: "passed" as const })),
    Match.tag("Reported", (r) => ({ label: r.label, result: reported(r.exitCode) })),
    Match.exhaustive
  );

const metaOf = (c: Constellation, row: TaskRow, now: number): string => {
  const attempts = c.attempts.filter((a) => a.taskId === row.id);
  const latest = attempts.at(-1);
  const since = latest?.claimedAt ?? latest?.startedAt ?? null;

  return [
    attempts.length === 0 ? "no attempt yet" : `attempt ${attempts.length}`,
    row.harness === null ? null : harnessName(row.harness),
    since === null ? null : elapsed(Date.parse(since), now),
  ]
    .filter((part) => part !== null)
    .join(" · ");
};

export const claimPane = (
  c: Constellation,
  rows: ReadonlyArray<TaskRow>,
  chart: SpanChart,
  chosen: string,
  now: number
): ClaimPane | null => {
  const row = rows.find((r) => r.id === chosen);
  const star = chart.tasks.find((t) => t.id === chosen);

  if (row === undefined || star === undefined) return null;
  const claim = c.attempts.filter((a) => a.taskId === row.id).at(-1)?.claim ?? null;
  const codeOf = new Map(chart.tasks.map((t) => [t.id, taskCode(t, chart.bands)]));
  const commits = claim?.commits.length ?? 0;

  return {
    kicker: `Task ${taskCode(star, chart.bands)} · wave ${star.wave}`,
    pill: pillOf(row),
    title: row.title,
    meta: metaOf(c, row, now),
    claim:
      claim === null
        ? null
        : {
            summary: claim.summary,
            checks: claim.receipts.map(checkOf),
            head: `head ${shortSha(claim.head)} · ${commits} ${commits === 1 ? "commit" : "commits"}`,
          },
    others: rows.flatMap((r) =>
      r.handed !== null && r.id !== row.id ? [{ id: r.id, label: codeOf.get(r.id) ?? r.id }] : []
    ),
  };
};
