/**
 * A Task's Logbook as a pure fold over its Constellation's events (ADR 0119). Nothing here is
 * stored: every read folds the log again, and the feed folds each new event onto the last.
 */
import {
  type Actor,
  type AttemptId,
  type AttemptNumber,
  ConstellationEvent,
  type LogbookAuthor,
  LogbookEntry,
  MessageTarget,
  type Sequence,
  type Task,
  type TaskId,
} from "@polaris/protocol";
import { Predicate } from "effect";
import {
  type ConstellationRecord,
  foldConstellation,
  questionKey,
} from "../../store/constellation.ts";
import { activeAttempt, latestAttempt } from "../projections.ts";

/** One committed Constellation event, as the store's envelope carries it. */
export interface LogbookEvent {
  readonly sequence: Sequence;
  readonly occurredAt: string;
  readonly event: ConstellationEvent;
}

/** Where an Attempt sits in its Task: its ordinal, and the event that started it. */
export interface AttemptOrdinal {
  readonly taskId: TaskId;
  readonly number: AttemptNumber;
  readonly sequence: Sequence;
}

/** What the fold carries between events: the graph, and each Attempt's ordinal. */
export interface LogbookFold {
  readonly record: ConstellationRecord | undefined;
  readonly ordinals: ReadonlyMap<AttemptId, AttemptOrdinal>;
}

export const emptyLogbook: LogbookFold = { record: undefined, ordinals: new Map() };

type Event<Tag extends ConstellationEvent["_tag"]> = Extract<ConstellationEvent, { _tag: Tag }>;

/** One event with the graph on both sides of it. */
interface Step {
  readonly before: ConstellationRecord;
  readonly after: ConstellationRecord;
  readonly ordinals: LogbookFold["ordinals"];
  readonly envelope: LogbookEvent;
}

const E = LogbookEntry.cases;

const none: ReadonlyArray<LogbookEntry> = [];

/** The fields every entry has. A null `attemptId` files it under the Task's latest Attempt. */
const base = (
  step: Step,
  taskId: TaskId,
  attemptId: AttemptId | null,
  author: LogbookAuthor,
  text: string,
  actor: Actor | null = null
) => {
  const filed = attemptId ?? latestAttempt(step.after.graph, taskId)?.id ?? null;

  return {
    id: `${step.envelope.sequence}:${taskId}`,
    sequence: step.envelope.sequence,
    taskId,
    attemptId: filed,
    attempt: filed === null ? null : (step.ordinals.get(filed)?.number ?? null),
    at: step.envelope.occurredAt,
    author,
    actor,
    text,
  };
};

const taskOf = (step: Step, attemptId: AttemptId) =>
  step.after.graph.attempts.find((a) => a.id === attemptId)?.taskId;

/** An entry on the Task of `attemptId`; nothing when the graph doesn't know the Attempt. */
const onAttempt = (
  step: Step,
  attemptId: AttemptId,
  make: (taskId: TaskId) => LogbookEntry
): ReadonlyArray<LogbookEntry> => {
  const taskId = taskOf(step, attemptId);

  return taskId === undefined ? none : [make(taskId)];
};

const brief = (step: Step, task: Task) =>
  E.Brief.make({
    ...base(step, task.id, null, "lead", task.brief),
    title: task.title,
    criteria: task.criteria,
  });

/** An edit is a Logbook entry only when it changes what the worker was told to do. */
const edited = (step: Step, task: Task): ReadonlyArray<LogbookEntry> => {
  const old = step.before.graph.tasks.find((t) => t.id === task.id);

  return old !== undefined &&
    old.brief === task.brief &&
    old.title === task.title &&
    old.criteria.length === task.criteria.length &&
    old.criteria.every((criterion, index) => criterion === task.criteria[index])
    ? none
    : [brief(step, task)];
};

/** Who sent an operator message. Events from before `by` was recorded are read from what they hold. */
const operatorAuthor = (step: Step, e: Event<"OperatorMessageSent">): LogbookAuthor => {
  if (e.by === "user" || e.actor !== null) return "you";

  if (e.by === "lead" || e.questionId === null || !Predicate.isTagged(e.target, "Worker"))
    return "lead";

  const question = step.before.questions.get(questionKey(e.target.attemptId, e.questionId));

  return question?.question.to === "user" ? "you" : "lead";
};

const operatorMessage = (
  step: Step,
  e: Event<"OperatorMessageSent">
): ReadonlyArray<LogbookEntry> => {
  const author = operatorAuthor(step, e);

  const message = (taskId: TaskId, attemptId: AttemptId) =>
    E.Message.make({
      ...base(step, taskId, attemptId, author, e.text, e.actor),
      channel: "operator",
      peer: null,
      outgoing: false,
    });

  return MessageTarget.match(e.target, {
    Lead: () => none,
    Worker: ({ attemptId }) =>
      onAttempt(step, attemptId, (taskId) =>
        e.questionId === null
          ? message(taskId, attemptId)
          : E.Answer.make({
              ...base(step, taskId, attemptId, author, e.text, e.actor),
              questionId: e.questionId,
            })
      ),
    // Every worker active when it was sent heard it.
    All: () => step.before.graph.attempts.filter(activeAttempt).map((a) => message(a.taskId, a.id)),
  });
};

/** A peer message is on both Logbooks: the sender's as outgoing, the recipient's as received. */
const peerMessage = (step: Step, e: Event<"PeerMessage">): ReadonlyArray<LogbookEntry> => {
  const from = taskOf(step, e.from);
  const to = taskOf(step, e.to);

  if (from === undefined || to === undefined) return none;

  const side = (taskId: TaskId, attemptId: AttemptId, peer: TaskId, outgoing: boolean) =>
    E.Message.make({
      ...base(step, taskId, attemptId, "worker", e.text),
      channel: "peer",
      peer,
      outgoing,
    });

  return from === to
    ? [side(from, e.from, to, true)]
    : [side(from, e.from, to, true), side(to, e.to, from, false)];
};

const question = (step: Step, e: Event<"NotificationQueued">): ReadonlyArray<LogbookEntry> => {
  const { item } = e.notification;

  if (!Predicate.isTagged(item, "Question")) return none;

  return onAttempt(step, item.attemptId, (taskId) =>
    E.Question.make({
      ...base(step, taskId, item.attemptId, "worker", item.question.text),
      question: item.question,
    })
  );
};

const claim = (step: Step, e: Event<"AttemptClaimed">) =>
  onAttempt(step, e.attemptId, (taskId) => {
    const old = step.before.graph.attempts.find((a) => a.id === e.attemptId);

    return E.Claim.make({
      ...base(step, taskId, e.attemptId, "worker", e.claim.summary),
      claim: e.claim,
      amends: old?.state === "review" ? (old.claim?.head ?? null) : null,
    });
  });

const review = (
  step: Step,
  attemptId: AttemptId,
  outcome: (typeof E.Review.Type)["outcome"],
  by: { readonly author: LogbookAuthor; readonly actor?: Actor | null },
  text: string,
  mergedHead: string | null = null
) =>
  onAttempt(step, attemptId, (taskId) =>
    E.Review.make({
      ...base(step, taskId, attemptId, by.author, text, by.actor ?? null),
      outcome,
      mergedHead,
    })
  );

const entriesOf = (step: Step): ReadonlyArray<LogbookEntry> =>
  ConstellationEvent.match(step.envelope.event, {
    ConstellationStarted: (e) => e.constellation.tasks.map((task) => brief(step, task)),
    TaskDeclared: (e) => [brief(step, e.task)],
    ProposalAccepted: (e) => [brief(step, e.task)],
    TaskEdited: (e) => edited(step, e.task),
    AttemptProgressed: (e) =>
      onAttempt(step, e.attemptId, (taskId) =>
        E.Progress.make({
          ...base(step, taskId, e.attemptId, "worker", e.note),
          completed: e.completed,
          total: e.total,
        })
      ),
    NotificationQueued: (e) => question(step, e),
    OperatorMessageSent: (e) => operatorMessage(step, e),
    PeerMessage: (e) => peerMessage(step, e),
    AttemptClaimed: (e) => claim(step, e),
    ClaimApproved: (e) =>
      review(step, e.attemptId, "approved", { author: "you", actor: e.actor }, ""),
    ClaimHandedUp: (e) =>
      review(step, e.attemptId, "handed_up", { author: "lead" }, e.reason ?? ""),
    AttemptAccepted: (e) =>
      review(
        step,
        e.attemptId,
        "accepted",
        { author: "lead" },
        (e.findings ?? []).map((f) => `${f.message}: ${f.fix}`).join("\n"),
        e.mergedHead
      ),
    AttemptRejected: (e) =>
      review(
        step,
        e.attemptId,
        "sent_back",
        { author: e.by === "user" || e.actor !== null ? "you" : "lead", actor: e.actor },
        e.reason
      ),
    AttemptSettled: (e) =>
      onAttempt(step, e.attemptId, (taskId) =>
        E.Lost.make({
          ...base(step, taskId, e.attemptId, "polaris", e.reason),
          outcome: e.outcome,
          failureKind: e.failureKind,
          resetsAt: e.resetsAt,
        })
      ),
    LogbookNoted: (e) => [
      E.Note.make({
        ...base(step, e.taskId, e.attemptId, e.author, e.text, e.actor),
        noteId: e.id,
      }),
    ],
    // The rest change the graph or deliver something already recorded: no entry of their own.
    ConstellationStateChanged: () => none,
    LeadHandoverRequested: () => none,
    LeadHandoverCancelled: () => none,
    LeadChanged: () => none,
    TaskCanceled: () => none,
    TaskProposed: () => none,
    ProposalDeclined: () => none,
    AttemptStarted: () => none,
    AttemptBlocked: () => none,
    AttemptUnblocked: () => none,
    AttemptNudged: () => none,
    AttemptInterrupted: () => none,
    AttemptStale: () => none,
    AttemptFresh: () => none,
    GatePromoted: () => none,
    LeadNotified: () => none,
    WorkerInputDelivered: () => none,
    OperatorMessageResolved: () => none,
    AttemptRecoveryContinued: () => none,
  });

/** Number the Attempts this event brought into the graph, in the order the graph holds them. */
const numbered = (
  ordinals: LogbookFold["ordinals"],
  after: ConstellationRecord,
  sequence: Sequence
): LogbookFold["ordinals"] => {
  const fresh = after.graph.attempts.filter((a) => !ordinals.has(a.id));

  if (fresh.length === 0) return ordinals;

  const next = new Map(ordinals);

  for (const attempt of fresh) {
    const earlier = [...next.values()].filter((o) => o.taskId === attempt.taskId).length;
    next.set(attempt.id, { taskId: attempt.taskId, number: earlier + 1, sequence });
  }

  return next;
};

/** One event folded: the next state, and the entries it added across every Task. */
export interface LogbookStep {
  readonly fold: LogbookFold;
  readonly entries: ReadonlyArray<LogbookEntry>;
}

export const stepLogbook = (fold: LogbookFold, envelope: LogbookEvent): LogbookStep => {
  const after = foldConstellation(fold.record, envelope.event, envelope.occurredAt);

  if (after === undefined) return { fold, entries: none };

  const ordinals = numbered(fold.ordinals, after, envelope.sequence);

  return {
    fold: { record: after, ordinals },
    entries: entriesOf({ before: fold.record ?? after, after, ordinals, envelope }),
  };
};

/** Fold a whole log, oldest first. */
export const foldLogbook = (envelopes: Iterable<LogbookEvent>) => {
  let fold = emptyLogbook;
  const entries: Array<LogbookEntry> = [];

  for (const envelope of envelopes) {
    const step = stepLogbook(fold, envelope);
    fold = step.fold;
    entries.push(...step.entries);
  }

  return { fold, entries };
};
