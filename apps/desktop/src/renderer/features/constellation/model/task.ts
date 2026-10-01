/**
 * One Task's rail row: the look, the actor lane, and the one or two caption lines that carry
 * state (liveness, the Claim at a glance, a Gate's receipts, why it needs you, an overlap).
 */
import type { HarnessKind, TaskId } from "@polaris/protocol";
import type { Overlap } from "./areas.ts";
import { acceptedGlance, type ClaimGlance, claimGlance, type ReceiptView } from "./claim.ts";
import { actorLine, harnessWord, span } from "./copy.ts";
import { CONTEXT_WARN, type Facts, NO_FACTS, type WorkerFacts } from "./facts.ts";
import { glyphFor, type TaskGlyphKind, type TaskLook, taskLook } from "./look.ts";
import type {
  AttemptData,
  ConstellationRecord,
  ProjectionData,
  Progress,
  TaskData,
} from "./types.ts";

export interface Liveness {
  readonly kind: "liveness";
  /** "bun run bench" (mono) or "waiting on bench (held by B2)". */
  readonly activity: string | null;
  readonly mono: boolean;
  readonly duration: string | null;
  readonly context: number | null;
  readonly queued: number;
  /** The worker's own progress note, "3/8 · writing properties". */
  readonly progress: string | null;
  /** The worker's Host is away: "devbox reconnecting". */
  readonly away: string | null;
}

export type Line =
  | Liveness
  | { readonly kind: "claim"; readonly glance: ClaimGlance }
  | {
      readonly kind: "accepted";
      readonly head: string;
      readonly receipts: ReadonlyArray<ReceiptView>;
    }
  | {
      readonly kind: "note";
      readonly text: string;
      readonly tone: "neutral" | "needs-you";
      readonly detail: string | null;
    };

export interface TaskRow {
  readonly kind: "task";
  readonly key: string;
  readonly task: TaskData;
  readonly attempt: AttemptData | null;
  /** One-based among this Task's Attempts. */
  readonly attemptNumber: number;
  readonly projection: ProjectionData;
  readonly look: TaskLook;
  readonly harness: HarnessKind | null;
  readonly actor: string;
  readonly line: Line | null;
  readonly overlap: Overlap | null;
  /** A Gate's inputs, each in its own state. */
  readonly inputs: ReadonlyArray<TaskGlyphKind> | null;
  /** Accept / Send back as buttons: the Constellation is paused or the Claim was handed up. */
  readonly promoted: boolean;
  /** Nested under a group (not on the trunk). */
  readonly nested: boolean;
}

const progressText = (p: Progress | undefined) => {
  if (p === undefined) return null;
  const count = p.completed !== null && p.total !== null ? `${p.completed}/${p.total}` : null;

  return [count, p.note].filter((x) => x !== null && x !== "").join(" · ") || null;
};

const awayText = (w: WorkerFacts) =>
  w.hostAway === null || w.remoteHost === null ? null : `${w.remoteHost} ${w.hostAway}`;

const liveness = (w: WorkerFacts, progress: Progress | undefined, now: number): Liveness | null => {
  const a = w.activity;

  const activity =
    a === null
      ? null
      : a.kind === "lease"
        ? `waiting on ${a.resource}${a.holder === null ? "" : ` (held by ${a.holder})`}`
        : a.text;

  const line: Liveness = {
    kind: "liveness",
    activity,
    mono: a !== null && a.kind !== "lease",
    duration: a === null ? null : span(a.since, now),
    context: w.contextPercent,
    queued: w.queued,
    progress: progressText(progress),
    away: awayText(w),
  };

  const empty = activity === null && line.progress === null && line.away === null;

  return empty && (w.contextPercent ?? 0) < CONTEXT_WARN && w.queued === 0 ? null : line;
};

interface LineInput {
  readonly row: Pick<TaskRow, "task" | "attempt" | "projection" | "look">;
  readonly worker: WorkerFacts;
  readonly record: ConstellationRecord;
  readonly facts: Facts;
}

const reviewLine = ({ row, worker, facts }: LineInput): Line | null => {
  if (!row.projection.branchFetched)
    return {
      kind: "note",
      text: "review · branch not yet fetched",
      tone: "neutral",
      detail: awayText(worker),
    };
  const claim = row.attempt?.claim;

  return claim == null ? null : { kind: "claim", glance: claimGlance(claim, facts) };
};

const lineFor = (input: LineInput): Line | null => {
  const { row, worker, record, facts } = input;
  const { attention } = row.look;

  if (attention?.kind === "approval")
    return {
      kind: "note",
      text: `waiting on your approval · ${span(attention.since, facts.now)}`,
      tone: "neutral",
      detail: null,
    };

  if (attention?.kind === "stopped")
    return {
      kind: "note",
      text: "stopped without claiming",
      tone: "neutral",
      detail: "nudged once",
    };

  if (attention?.kind === "question")
    return { kind: "note", text: attention.text, tone: "needs-you", detail: null };

  if (row.projection.state === "review") return reviewLine(input);

  if (row.projection.state === "working" && row.attempt !== null)
    return liveness(worker, record.progress.get(row.attempt.id), facts.now);

  if (row.task.kind === "gate" && row.projection.state === "done" && row.attempt !== null) {
    const glance = acceptedGlance(row.attempt, facts);

    return glance === null ? null : { kind: "accepted", ...glance };
  }

  return null;
};

export interface TaskContext {
  readonly record: ConstellationRecord;
  readonly facts: Facts;
  readonly projections: ReadonlyMap<TaskId, ProjectionData>;
  readonly attempts: ReadonlyMap<TaskId, ReadonlyArray<AttemptData>>;
  readonly overlaps: ReadonlyMap<TaskId, Overlap>;
  readonly tasks: ReadonlyMap<TaskId, TaskData>;
  /** Rows drop to one line (large Constellations). */
  readonly oneLine: boolean;
}

/** A Task the Daemon hasn't projected yet reads as waiting. */
const unprojected = (taskId: TaskId): ProjectionData => ({
  taskId,
  state: "waiting",
  latestAttemptId: null,
  blockedBy: [],
  gatePromoted: false,
  stale: false,
  branchFetched: true,
  liveness: null,
});

const inputGlyphs = (task: TaskData, ctx: TaskContext) =>
  task.deps.map((dep) => {
    const p = ctx.projections.get(dep) ?? unprojected(dep);

    return glyphFor(p, { needsYou: false, isGate: ctx.tasks.get(dep)?.kind === "gate" });
  });

const actorFor = (
  task: TaskData,
  attempt: AttemptData | null,
  w: WorkerFacts,
  ctx: TaskContext
) => {
  if (task.kind === "gate") return actorLine("lead", ctx.facts.lead.model, null);

  if (attempt === null)
    return actorLine(
      harnessWord(task.suggested?.harness ?? null),
      task.suggested?.model ?? null,
      null
    );

  return actorLine(harnessWord(w.harness), w.model, w.remoteHost);
};

export const taskRow = (task: TaskData, nested: boolean, ctx: TaskContext): TaskRow => {
  const { record, facts } = ctx;
  const projection = ctx.projections.get(task.id) ?? unprojected(task.id);
  const history = ctx.attempts.get(task.id) ?? [];
  const attempt = history.at(-1) ?? null;
  const worker = attempt === null ? null : facts.worker(attempt);
  const look = taskLook(record.constellation, task, projection, attempt, facts);
  const known = worker ?? NO_FACTS;
  const base = { task, attempt, projection, look };

  return {
    kind: "task",
    key: `task:${task.id}`,
    ...base,
    attemptNumber: history.length,
    harness:
      task.kind === "gate"
        ? ctx.facts.lead.harness
        : (worker?.harness ?? task.suggested?.harness ?? null),
    actor: actorFor(task, attempt, known, ctx),
    line:
      ctx.oneLine || (worker === null && task.kind !== "gate")
        ? null
        : lineFor({ row: base, worker: known, record, facts }),
    overlap: ctx.oneLine ? null : (ctx.overlaps.get(task.id) ?? null),
    inputs: task.kind === "gate" ? inputGlyphs(task, ctx) : null,
    promoted:
      projection.state === "review" &&
      (record.constellation.state === "paused" || look.attention?.kind === "handed"),
    nested,
  };
};
