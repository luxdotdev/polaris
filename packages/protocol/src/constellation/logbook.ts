/**
 * A Task's Logbook (ADR 0119): derived by folding the Constellation's events, never stored.
 * The Daemon folds it; Clients read pages of it and follow its feed.
 */
import { Schema } from "effect";
import { Actor } from "../extensions.ts";
import { HarnessKind } from "../harnesses.ts";
import { HostId, Sequence, SessionId, Timestamp } from "../ids.ts";
import { ModelId, optionalNullable } from "../models.ts";
import {
  AttemptId,
  AttemptState,
  Claim,
  ConstellationId,
  ConstellationQuestion,
  FailureKind,
  Revision,
  TaskId,
} from "./domain.ts";

/** Who an entry is from, as a role. `you` is the user; `polaris` is the system. */
export const LogbookAuthor = Schema.Literals(["worker", "lead", "you", "inspector", "polaris"]);

export type LogbookAuthor = typeof LogbookAuthor.Type;

/** Who may write a note: the Task's current Attempt, the Lead or the user. */
export const LogbookNoteAuthor = Schema.Literals(["worker", "lead", "you"]);

export type LogbookNoteAuthor = typeof LogbookNoteAuthor.Type;

/** An Attempt's ordinal within its Task, from 1. */
export const AttemptNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export type AttemptNumber = typeof AttemptNumber.Type;

/** What every entry carries. `attemptId` and `attempt` are null before the Task's first Attempt. */
const entry = {
  /** Stable for one entry across reads: its event's sequence, then its Task. */
  id: Schema.NonEmptyString,
  /** The committed event the entry came from; pages and cursors order by it. */
  sequence: Sequence,
  taskId: TaskId,
  attemptId: Schema.NullOr(AttemptId),
  attempt: Schema.NullOr(AttemptNumber),
  at: Timestamp,
  author: LogbookAuthor,
  /** A Teammate who wrote it through a Share; null for the owner and for agents. */
  actor: optionalNullable(Actor),
  text: Schema.String,
};

export const InspectionVerdict = Schema.Literals(["approve", "send_back"]);

export type InspectionVerdict = typeof InspectionVerdict.Type;

/**
 * Where an Inspection's verdict went: to the Lead, which accepts; straight to Accept, when the
 * Lead granted the Inspector that; or back to the worker as a SendBack.
 */
export const InspectionRoute = Schema.Literals(["lead", "accepted", "sent_back"]);

export type InspectionRoute = typeof InspectionRoute.Type;

export const ReviewOutcome = Schema.Literals(["approved", "handed_up", "accepted", "sent_back"]);

export type ReviewOutcome = typeof ReviewOutcome.Type;

/** One row of a Logbook. `text` is the row's body; each kind adds what only it has. */
export const LogbookEntry = Schema.TaggedUnion({
  /** The Task's brief as declared, and again whenever an edit changes it. */
  Brief: { ...entry, title: Schema.String, criteria: Schema.Array(Schema.String) },
  Progress: {
    ...entry,
    completed: Schema.NullOr(Revision),
    total: Schema.NullOr(Revision),
  },
  Question: { ...entry, question: ConstellationQuestion },
  Answer: { ...entry, questionId: Schema.String },
  /**
   * An operator message to the Task's worker, or a peer message it sent or received. `peer` is
   * the other Task of a peer message; `outgoing` is true on the sender's Logbook.
   */
  Message: {
    ...entry,
    channel: Schema.Literals(["operator", "peer"]),
    peer: Schema.NullOr(TaskId),
    outgoing: Schema.Boolean,
  },
  /** `amends` is the head this Claim replaced while in review; null for a first Claim. */
  Claim: { ...entry, claim: Claim, amends: Schema.NullOr(Schema.String) },
  /** `mergedHead` is set on `accepted`; `text` is the reason on `handed_up` and `sent_back`. */
  Review: { ...entry, outcome: ReviewOutcome, mergedHead: Schema.NullOr(Schema.String) },
  /** `nextAttempt` is the Attempt a `sent_back` verdict started; null until it has. */
  Inspection: {
    ...entry,
    verdict: InspectionVerdict,
    route: InspectionRoute,
    nextAttempt: Schema.NullOr(AttemptNumber),
  },
  /** An Attempt that settled without a Claim being accepted or sent back; `text` is the reason. */
  Lost: {
    ...entry,
    outcome: Schema.Literals(["lost", "failed"]),
    failureKind: Schema.NullOr(FailureKind),
    resetsAt: Schema.NullOr(Timestamp),
  },
  /** Record only: a note is never delivered to a worker as a message. */
  Note: { ...entry, noteId: Schema.String },
});

export type LogbookEntry = typeof LogbookEntry.Type;

export type LogbookEntryKind = LogbookEntry["_tag"];

/**
 * An Attempt boundary: the row that starts each Attempt. It is the Attempt as it stands at the
 * page's cursor, so a later page replaces it. `harness` and `model` are null when the Host
 * serving the read doesn't hold the worker's session.
 */
export class LogbookAttempt extends Schema.Class<LogbookAttempt>("ConstellationLogbookAttempt")({
  taskId: TaskId,
  attemptId: AttemptId,
  number: AttemptNumber,
  /** Why it started: the AttemptCause tag. */
  cause: Schema.Literals([
    "Initial",
    "SentBack",
    "MergeConflict",
    "Recover",
    "Followup",
    "Superseded",
  ]),
  sessionId: SessionId,
  hostId: HostId,
  harness: Schema.NullOr(HarnessKind),
  model: Schema.NullOr(ModelId),
  state: AttemptState,
  /** The event that started it: entries with a greater sequence and this Attempt follow it. */
  sequence: Sequence,
  startedAt: Timestamp,
  endedAt: Schema.NullOr(Timestamp),
}) {}

/**
 * A read of a Logbook. `entries` are oldest first and all come after the request's `since`;
 * `attempts` is always every boundary in scope. Pass `cursor` as the next `since`.
 */
export class LogbookPage extends Schema.Class<LogbookPage>("ConstellationLogbookPage")({
  constellationId: ConstellationId,
  /** The Task read; null for every Task of the Constellation. */
  taskId: Schema.NullOr(TaskId),
  attempts: Schema.Array(LogbookAttempt),
  entries: Schema.Array(LogbookEntry),
  cursor: Sequence,
}) {}

/**
 * Which Logbook, and from where. `taskId` absent reads every Task's entries, for the Lead and
 * the user only. `since` absent reads from the start.
 */
export const LogbookQuery = {
  constellationId: ConstellationId,
  taskId: Schema.optionalKey(TaskId),
  since: Schema.optionalKey(Sequence),
};
