/**
 * The rail list (DESIGN.md, Rows, not a canvas): handovers at the top of the trunk, groups
 * with trailing counts, Tasks, proposals; large Constellations fold and filter.
 */
import type { TaskId } from "@polaris/protocol";
import { areaOverlaps } from "./areas.ts";
import { idRanges, span } from "./copy.ts";
import type { Facts, SubagentFact } from "./facts.ts";
import type { Bucket, TaskGlyphKind } from "./look.ts";
import { type TaskContext, type TaskRow, taskRow } from "./task.ts";
import type { AttemptData, ConstellationRecord, Handover, Proposal, TaskData } from "./types.ts";

/** Past this many Tasks the tab folds groups, adds filters and drops rows to one line. */
export const LARGE = 100;

export type Filter = "all" | "needs-you" | "review" | "working" | "done";

export type Tally = Readonly<Record<Bucket, number>> & { readonly proposed: number };

export type RailRow =
  | { readonly kind: "handover"; readonly key: string; readonly handover: Handover }
  | {
      readonly kind: "group";
      readonly key: string;
      readonly group: string;
      readonly label: string;
      readonly total: number;
      readonly open: boolean;
      readonly tally: Tally;
      readonly glyph: TaskGlyphKind;
    }
  | TaskRow
  | {
      readonly kind: "proposal";
      readonly key: string;
      readonly proposal: Proposal;
      readonly by: string | null;
      readonly nested: boolean;
    }
  | {
      readonly kind: "waiting";
      readonly key: string;
      readonly group: string;
      readonly ids: string;
      readonly count: number;
    }
  | {
      readonly kind: "subagent";
      readonly key: string;
      /** The Task whose Attempt's session spawned it. */
      readonly parent: TaskRow;
      readonly subagent: SubagentFact;
      readonly age: string;
    }
  | { readonly kind: "note"; readonly key: string; readonly text: string };

export interface RailOptions {
  /** Groups the user opened (true) or folded (false); others take their default. */
  readonly folds: ReadonlyMap<string, boolean>;
  readonly filter: Filter;
  readonly query: string;
}

export const DEFAULT_RAIL: RailOptions = { folds: new Map(), filter: "all", query: "" };

const EMPTY_TALLY: Tally = {
  "needs-you": 0,
  review: 0,
  working: 0,
  done: 0,
  waiting: 0,
  future: 0,
  ended: 0,
  proposed: 0,
};

export const tallyOf = (rows: ReadonlyArray<TaskRow>, proposed = 0): Tally => {
  const tally: Record<keyof Tally, number> = { ...EMPTY_TALLY, proposed };

  for (const row of rows) tally[row.look.bucket] += 1;

  return tally;
};

const groupGlyph = (group: string, tally: Tally, total: number): TaskGlyphKind => {
  if (tally["needs-you"] > 0) return "needs-you";

  if (group === GATES) return "gate";

  if (tally.review + tally.working > 0) return "review";

  if (total > 0 && tally.done === total) return "accepted";

  return group === FUTURES || tally.future === total ? "future" : "waiting";
};

const GATES = "Gates";

const FUTURES = "Futures";

/** The group a Task sits in; large Constellations gather ungrouped Gates and Futures. */
const groupOf = (task: TaskData, row: TaskRow, large: boolean) => {
  if (task.group != null && task.group !== "") return task.group;

  if (!large) return null;

  if (task.kind === "gate") return GATES;

  return row.look.bucket === "future" ? FUTURES : "Other tasks";
};

const MATCHES: Readonly<Record<Exclude<Filter, "all">, Bucket>> = {
  "needs-you": "needs-you",
  review: "review",
  working: "working",
  done: "done",
};

const matches = (row: TaskRow, filter: Filter, query: string) => {
  if (filter !== "all" && row.look.bucket !== MATCHES[filter]) return false;

  if (query === "") return true;
  const q = query.toLowerCase();
  const { task } = row;

  return (
    task.id.toLowerCase().includes(q) ||
    task.title.toLowerCase().includes(q) ||
    task.area.some((glob) => glob.toLowerCase().includes(q))
  );
};

const indexBy = (record: ConstellationRecord, facts: Facts, oneLine: boolean): TaskContext => {
  const { constellation } = record;
  const projections = new Map(record.projections.map((p) => [p.taskId, p]));
  const attempts = new Map<TaskId, Array<AttemptData>>();

  for (const a of constellation.attempts)
    attempts.set(a.taskId, [...(attempts.get(a.taskId) ?? []), a]);

  return {
    record,
    facts,
    projections,
    attempts,
    overlaps: areaOverlaps(constellation.tasks, projections),
    tasks: new Map(constellation.tasks.map((t) => [t.id, t])),
    oneLine,
  };
};

interface Group {
  readonly name: string;
  readonly rows: Array<TaskRow>;
  readonly proposals: Array<Proposal>;
}

/** Tasks in declaration order, gathered into groups in order of first appearance. */
const gather = (record: ConstellationRecord, ctx: TaskContext, large: boolean) => {
  const groups = new Map<string, Group>();
  const trunk: Array<TaskRow> = [];
  const owner = new Map<string, string | null>();

  for (const task of record.constellation.tasks) {
    const probe = taskRow(task, true, ctx);
    const name = groupOf(task, probe, large);

    owner.set(task.id, name);

    if (name === null) trunk.push({ ...probe, nested: false });
    else {
      const group = groups.get(name) ?? { name, rows: [], proposals: [] };

      group.rows.push(probe);
      groups.set(name, group);
    }
  }

  const loose: Array<Proposal> = [];

  for (const proposal of record.proposals) {
    const byTask = record.constellation.attempts.find((a) => a.id === proposal.by)?.taskId;
    const name = large ? FUTURES : (owner.get(byTask ?? "") ?? null);

    const group =
      name === null ? undefined : (groups.get(name) ?? { name, rows: [], proposals: [] });

    if (group === undefined || name === null) loose.push(proposal);
    else {
      group.proposals.push(proposal);
      groups.set(name, group);
    }
  }

  return { groups: [...groups.values()], trunk, loose };
};

const proposalRow = (
  proposal: Proposal,
  record: ConstellationRecord,
  nested: boolean
): RailRow => ({
  kind: "proposal",
  key: `proposal:${proposal.proposalId}`,
  proposal,
  by: record.constellation.attempts.find((a) => a.id === proposal.by)?.taskId ?? null,
  nested,
});

/** A working Attempt's Subagents, each a node under its row (not in large Constellations). */
const withSubagents = (rows: ReadonlyArray<TaskRow>, facts: Facts): ReadonlyArray<RailRow> =>
  rows.flatMap((row): ReadonlyArray<RailRow> => {
    if (row.attempt === null || row.projection.state !== "working") return [row];

    return [
      row,
      ...facts.worker(row.attempt).subagents.map((subagent) => ({
        kind: "subagent" as const,
        key: `subagent:${subagent.id}`,
        parent: row,
        subagent,
        age: span(subagent.since, facts.now),
      })),
    ];
  });

interface Emit {
  readonly facts: Facts;
  readonly record: ConstellationRecord;
  readonly options: RailOptions;
  readonly large: boolean;
  readonly filtering: boolean;
}

const groupRows = (group: Group, emit: Emit): ReadonlyArray<RailRow> => {
  const { options, large, filtering, record } = emit;
  const shown = group.rows.filter((r) => matches(r, options.filter, options.query));

  if (filtering && shown.length === 0) return [];
  const tally = tallyOf(group.rows, group.proposals.length);
  const fallback = !large || tally["needs-you"] > 0;
  const open = filtering || (options.folds.get(group.name) ?? fallback);

  const header: RailRow = {
    kind: "group",
    key: `group:${group.name}`,
    group: group.name,
    label: group.name,
    total: group.rows.length,
    open,
    tally,
    glyph: groupGlyph(group.name, tally, group.rows.length),
  };

  if (!open) return [header];
  const waitingKey = `${group.name}\u0000waiting`;
  const foldWaiting = large && !filtering && !(options.folds.get(waitingKey) ?? false);
  const waiting = foldWaiting ? shown.filter((r) => r.look.bucket === "waiting") : [];
  const rest = shown.filter((r) => !waiting.includes(r));

  const fold: ReadonlyArray<RailRow> =
    waiting.length < 2
      ? []
      : [
          {
            kind: "waiting",
            key: `waiting:${group.name}`,
            group: waitingKey,
            ids: idRanges(waiting.map((r) => r.task.id)),
            count: waiting.length,
          },
        ];

  const tasks = waiting.length < 2 ? shown : rest;

  return [
    header,
    ...(large ? tasks : withSubagents(tasks, emit.facts)),
    ...fold,
    ...(filtering ? [] : group.proposals.map((p) => proposalRow(p, record, true))),
  ];
};

export interface Rail {
  readonly rows: ReadonlyArray<RailRow>;
  readonly large: boolean;
  /** Counts for the filter chips, across every Task. */
  readonly counts: Readonly<Record<Filter, number>>;
  readonly tasks: ReadonlyArray<TaskRow>;
}

export const buildRail = (
  record: ConstellationRecord,
  facts: Facts,
  options: RailOptions = DEFAULT_RAIL
): Rail => {
  const large = record.constellation.tasks.length >= LARGE;
  const ctx = indexBy(record, facts, large);
  const filtering = options.filter !== "all" || options.query.trim() !== "";

  const emit: Emit = {
    facts,
    record,
    options: { ...options, query: options.query.trim() },
    large,
    filtering,
  };

  const { groups, trunk, loose } = gather(record, ctx, large);
  const all = [...groups.flatMap((g) => g.rows), ...trunk];
  const tally = tallyOf(all);

  const handovers: ReadonlyArray<RailRow> = filtering
    ? []
    : record.handovers.toReversed().map((handover) => ({
        kind: "handover",
        key: `handover:${handover.revision}`,
        handover,
      }));

  const looseTasks = trunk.filter((r) => matches(r, emit.options.filter, emit.options.query));

  const note: ReadonlyArray<RailRow> =
    large && !filtering
      ? [
          {
            kind: "note",
            key: "note",
            text: `${all.length} tasks · groups with nothing for you stay folded; one that needs you opens itself`,
          },
        ]
      : [];

  return {
    rows: [
      ...handovers,
      ...groups.flatMap((g) => groupRows(g, emit)),
      ...(large ? looseTasks : withSubagents(looseTasks, facts)),
      ...(filtering ? [] : loose.map((p) => proposalRow(p, record, false))),
      ...note,
    ],
    large,
    counts: {
      all: all.length,
      "needs-you": tally["needs-you"],
      review: tally.review,
      working: tally.working,
      done: tally.done,
    },
    tasks: all,
  };
};
