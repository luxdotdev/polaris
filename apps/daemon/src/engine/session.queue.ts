/**
 * Queued Turns in the Session machine (ENG-941, README.md here): in a shared session a Turn
 * sent while one is in flight waits its turn, and starts when the Turn before it ends.
 */
import {
  Actor,
  DomainEvent,
  mayChangeQueuedTurn,
  QueuedTurn,
  queuedTurnMayStart,
  type ShareId,
  type Turn,
} from "@polaris/protocol";
import { Predicate, Result } from "effect";
import { patchTurn, type SessionRecord, workingTurn } from "../store/model.ts";
import { queueOf } from "../store/queuedTurns.ts";
import type { SessionInput } from "./session.inputs.ts";
import { type Context, type Enqueue, need, reject, settle } from "./session.settle.ts";
import { turnRefusal, userTurn } from "./session.turns.ts";

/** The most Turns a session keeps waiting; one more is refused. */
export const QUEUE_LIMIT = 20;

const QUEUES = new Set(["starting", "working", "needs-you"]);

type SendInput = Extract<SessionInput, { type: "turn.send" }>;

/** Whether a sent Turn waits: asked to queue, with a Turn in flight the Harness is running. */
export const queuesTurn = (record: SessionRecord, input: SendInput): boolean =>
  input.queue === true && workingTurn(record) !== undefined && QUEUES.has(record.session.state);

/** The sent Turn joining the queue, or why it can't. The decider stamps who sent it. */
export const queueTurn = (
  record: SessionRecord,
  turn: Turn,
  approves: boolean
): Result.Result<ReadonlyArray<DomainEvent>, string> =>
  queueOf(record).length >= QUEUE_LIMIT
    ? Result.fail(`the queue is full (${QUEUE_LIMIT} Turns); wait for one to start`)
    : Result.succeed([
        DomainEvent.cases.TurnQueued.make({
          turn: new QueuedTurn({
            id: turn.id,
            sessionId: record.session.id,
            prompt: turn.prompt,
            attachments: turn.attachments,
            actor: turn.actor ?? Actor.cases.Client.make({}),
            queuedAt: turn.startedAt,
            editedAt: null,
            approves,
          }),
        }),
      ]);

const cancelledByHost = (queued: QueuedTurn, reason: string) =>
  DomainEvent.cases.QueuedTurnCancelled.make({
    sessionId: queued.sessionId,
    turnId: queued.id,
    actor: null,
    reason,
  });

/** Why a queued Turn may not start any more: its sender lost the access it queued with. */
const barred = (
  record: SessionRecord,
  queued: QueuedTurn,
  endedShares: ReadonlyArray<ShareId>
): string | null => {
  if (Predicate.isTagged(queued.actor, "Teammate") && endedShares.includes(queued.actor.shareId))
    return "Their Share ended";

  return queuedTurnMayStart(queued, record.session.permissionMode)
    ? null
    : "The session approves for itself now, and its sender can't approve";
};

/**
 * What a clean Turn end does to the queue: Turns whose sender lost access are cancelled, and
 * the first of the rest starts at `at`, keeping its Actor (`started` is null with none left).
 */
export const nextQueued = (
  record: SessionRecord,
  at: string,
  endedShares: ReadonlyArray<ShareId>
) => {
  const cancelled: Array<DomainEvent> = [];
  const waiting: Array<QueuedTurn> = [];

  for (const queued of queueOf(record)) {
    const reason = barred(record, queued, endedShares);

    if (reason === null) waiting.push(queued);
    else cancelled.push(cancelledByHost(queued, reason));
  }

  const [head] = waiting;

  if (head === undefined) return { cancelled, started: null };

  const turn = patchTurn(
    userTurn(record.session, {
      id: head.id,
      prompt: head.prompt,
      attachments: head.attachments,
      at,
    }),
    { actor: head.actor }
  );

  return { cancelled, started: DomainEvent.cases.TurnStarted.make({ turn, actor: head.actor }) };
};

/** Every queued Turn dropped by the Host: the Turn in flight did not end cleanly. */
export const dropQueue = (record: SessionRecord, reason: string): Array<DomainEvent> =>
  queueOf(record).map((queued) => cancelledByHost(queued, reason));

type ChangeInput = Extract<SessionInput, { type: "queue.cancel" | "queue.edit" }>;

/** A cancel or an edit of a queued Turn by its author or the owner, or why it is refused. */
export const changeQueued = (
  record: SessionRecord,
  input: ChangeInput
): Result.Result<ReadonlyArray<DomainEvent>, string> => {
  const queued = queueOf(record).find((q) => q.id === input.turnId);
  const cancel = input.type === "queue.cancel";

  if (queued === undefined) return Result.fail("that Turn is no longer queued");

  if (!mayChangeQueuedTurn(queued, input.actor))
    return Result.fail(
      `only its author or the session's owner can ${cancel ? "cancel" : "edit"} a queued Turn`
    );

  const target = { sessionId: record.session.id, turnId: queued.id, actor: input.actor };

  if (cancel)
    return Result.succeed([
      DomainEvent.cases.QueuedTurnCancelled.make({ ...target, reason: null }),
    ]);

  if (input.prompt.trim() === "") return Result.fail("the prompt is empty");

  return Result.succeed(
    input.prompt === queued.prompt
      ? []
      : [DomainEvent.cases.QueuedTurnEdited.make({ ...target, prompt: input.prompt })]
  );
};

/** A Turn sent with one in flight: it joins a shared session's queue, else it is refused. */
export const queueOrRefuse = (
  { context, event }: { context: Context; event: SendInput },
  enq: Enqueue
) => {
  const record = need(context);

  if (!queuesTurn(record, event)) return reject(enq, turnRefusal(record, "send"));
  const queued = queueTurn(record, event.turn, event.approves !== false);

  return Result.isSuccess(queued)
    ? settle(enq, record, queued.success)
    : reject(enq, queued.failure);
};

/** A queued Turn cancelled or edited, or the refusal. */
export const changeQueue = (
  { context, event }: { context: Context; event: ChangeInput },
  enq: Enqueue
) => {
  const record = need(context);
  const changed = changeQueued(record, event);

  return Result.isSuccess(changed)
    ? settle(enq, record, changed.success)
    : reject(enq, changed.failure);
};
