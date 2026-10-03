/**
 * How one Task reads at a glance (DESIGN.md, rule/constellation-colour): its rail glyph, the
 * colour of its id and state word, and whether it needs you.
 */
import type { TaskState } from "@polaris/protocol";
import { Predicate } from "effect";
import { idRanges, span } from "./copy.ts";
import type { Facts, WorkerFacts } from "./facts.ts";
import { currentSetup, type SetupRun } from "./setup.ts";
import type { AttemptData, ConstellationData, ProjectionData, TaskData } from "./types.ts";

export type TaskGlyphKind =
  | "working"
  | "review"
  | "review-unfetched"
  | "needs-you"
  | "accepted"
  | "waiting"
  | "future"
  | "gate"
  | "gate-accepted"
  | "failed"
  | "stopped";

export type Tone = "neutral" | "accepted" | "needs-you" | "failed" | "faint";

/** Why a Task needs you, in the order Needs you ranks them (spec §5). */
export type Attention =
  | { readonly kind: "approval"; readonly since: string }
  | { readonly kind: "question"; readonly text: string }
  | { readonly kind: "handed" }
  | { readonly kind: "stopped" }
  /** Worktree setup failed before the Attempt could start (it ranks with "stopped"). */
  | { readonly kind: "setup"; readonly run: SetupRun };

/** The buckets groups count and filters use. */
export type Bucket = "needs-you" | "review" | "working" | "done" | "waiting" | "ended";

export interface TaskLook {
  readonly glyph: TaskGlyphKind;
  readonly idTone: Tone;
  readonly word: string;
  readonly wordTone: Tone;
  /** "verified", "reported" or "asserted" after "done". */
  readonly evidence: string | null;
  readonly attention: Attention | null;
  readonly bucket: Bucket;
}

const ENDED: ReadonlySet<TaskState> = new Set(["canceled", "lost"]);

/** The rail glyph for a projection; shared with the sidebar's worker rows. */
export const glyphFor = (
  projection: Pick<ProjectionData, "state" | "branchFetched">,
  options: { readonly needsYou: boolean; readonly isGate: boolean }
): TaskGlyphKind => {
  const { state } = projection;

  if (options.needsYou) return "needs-you";

  if (options.isGate && state === "done") return "gate-accepted";

  if (options.isGate && state !== "working" && state !== "review") return "gate";

  if (state === "done") return "accepted";

  if (state === "working") return "working";

  if (state === "review") return projection.branchFetched ? "review" : "review-unfetched";

  if (state === "failed") return "failed";

  if (ENDED.has(state)) return "stopped";

  return "waiting";
};

/** The question to the user a Task's latest Attempt is waiting on, if any. */
export const userQuestion = (c: ConstellationData, attemptId: string | null) => {
  if (attemptId === null) return null;

  for (const n of c.pendingNotifications ?? []) {
    if (
      Predicate.isTagged(n.item, "Question") &&
      n.item.attemptId === attemptId &&
      n.item.question.to === "user"
    )
      return n.item.question.text;
  }

  return null;
};

const attentionOf = (
  c: ConstellationData,
  projection: ProjectionData,
  attempt: AttemptData | null,
  worker: WorkerFacts
): Attention | null => {
  if (
    attempt === null ||
    (projection.state !== "working" &&
      projection.state !== "blocked" &&
      projection.state !== "review")
  )
    return null;

  if (worker.approvalSince !== null) return { kind: "approval", since: worker.approvalSince };
  const question = userQuestion(c, attempt.id);

  if (question !== null) return { kind: "question", text: question };

  if (projection.state === "review" && attempt.handedUpAt != null) return { kind: "handed" };

  return worker.stoppedWithoutClaiming && projection.state === "working"
    ? { kind: "stopped" }
    : null;
};

const ATTENTION_WORD: Readonly<Record<Attention["kind"], string>> = {
  approval: "needs you",
  question: "asks you",
  handed: "handed to you",
  stopped: "needs you",
  setup: "setup failed",
};

const STATE_WORD: Readonly<Record<TaskState, string>> = {
  waiting: "waiting",
  ready: "ready",
  working: "working",
  blocked: "blocked",
  review: "in review",
  done: "done",
  canceled: "canceled",
  lost: "lost",
  failed: "failed",
};

const BUCKET: Readonly<Record<TaskState, Bucket>> = {
  waiting: "waiting",
  ready: "waiting",
  working: "working",
  blocked: "waiting",
  review: "review",
  done: "done",
  canceled: "ended",
  lost: "ended",
  failed: "ended",
};

const wordFor = (task: TaskData, p: ProjectionData, attempt: AttemptData | null, now: number) => {
  if (p.state === "working" && attempt !== null) return `working · ${span(attempt.startedAt, now)}`;

  if (task.kind === "gate" && (p.state === "waiting" || p.state === "ready"))
    return p.blockedBy.length > 0 ? `waits ${idRanges(p.blockedBy)}` : "ready";

  return STATE_WORD[p.state];
};

const toneOf = (state: TaskState): Tone => {
  if (state === "done") return "accepted";

  if (state === "failed") return "failed";

  return ENDED.has(state) ? "faint" : "neutral";
};

/** Setup runs on the Host outside the worker cap: neutral while running, needs you once failed. */
const setupLook = (run: SetupRun, failed: boolean): TaskLook =>
  failed
    ? {
        glyph: "needs-you",
        idTone: "needs-you",
        word: ATTENTION_WORD.setup,
        wordTone: "needs-you",
        evidence: null,
        attention: { kind: "setup", run },
        bucket: "needs-you",
      }
    : {
        glyph: "waiting",
        idTone: "neutral",
        word: "setting up",
        wordTone: "neutral",
        evidence: null,
        attention: null,
        bucket: "working",
      };

export const taskLook = (
  c: ConstellationData,
  task: TaskData,
  projection: ProjectionData,
  attempt: AttemptData | null,
  facts: Facts
): TaskLook => {
  const setup = currentSetup(facts.setup(task.id), attempt);

  if (setup !== null) return setupLook(setup.run, setup.failed);
  const worker = attempt === null ? null : facts.worker(attempt);
  const attention = worker === null ? null : attentionOf(c, projection, attempt, worker);
  const isGate = task.kind === "gate";
  const glyph = glyphFor(projection, { needsYou: attention !== null, isGate });

  if (attention !== null)
    return {
      glyph,
      idTone: "needs-you",
      word: ATTENTION_WORD[attention.kind],
      wordTone: "needs-you",
      evidence: null,
      attention,
      bucket: "needs-you",
    };
  const slot = worker?.activity?.kind === "slot" ? worker.activity : null;

  if (slot !== null && projection.state === "working")
    return {
      glyph: "waiting",
      idTone: "neutral",
      word: `waiting · ${span(slot.since, facts.now)}`,
      wordTone: "neutral",
      evidence: null,
      attention: null,
      bucket: "working",
    };
  const tone = toneOf(projection.state);

  return {
    glyph,
    idTone: tone === "faint" ? "faint" : tone,
    word: wordFor(task, projection, attempt, facts.now),
    wordTone: tone,
    evidence: projection.state === "done" ? (attempt?.evidence ?? null) : null,
    attention: null,
    bucket: BUCKET[projection.state],
  };
};
