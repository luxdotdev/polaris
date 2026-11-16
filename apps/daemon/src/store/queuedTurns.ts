/**
 * Queued Turns in the read model (ENG-941): each session's queue in arrival order, folded
 * from its queue events and from the `TurnStarted` of a Turn that leaves it.
 */
import { type DomainEvent, QueuedTurn, type SessionId, type TurnId } from "@polaris/protocol";
import { Match } from "effect";
import type { ReadModel, SessionRecord } from "./model.ts";

const NONE: ReadonlyArray<QueuedTurn> = [];

/** The session's queued Turns, first to start first. */
export const queueOf = (record: SessionRecord): ReadonlyArray<QueuedTurn> => record.queue ?? NONE;

const withQueue = (
  model: ReadModel,
  sessionId: SessionId,
  f: (queue: ReadonlyArray<QueuedTurn>) => ReadonlyArray<QueuedTurn>
): ReadModel => {
  const record = model.sessions.get(sessionId);

  if (record === undefined) return model;
  const before = queueOf(record);
  const queue = f(before);

  if (queue === before) return model;
  const sessions = new Map(model.sessions);

  sessions.set(sessionId, { ...record, queue });

  return { ...model, sessions };
};

const without = (queue: ReadonlyArray<QueuedTurn>, turnId: TurnId) =>
  queue.some((queued) => queued.id === turnId)
    ? queue.filter((queued) => queued.id !== turnId)
    : queue;

export type QueuedTurnEvent = Extract<
  DomainEvent,
  { readonly _tag: "TurnQueued" | "QueuedTurnEdited" | "QueuedTurnCancelled" }
>;

/** Fold one queue event, recorded `at`. */
export const foldQueuedTurn = (model: ReadModel, event: QueuedTurnEvent, at: string): ReadModel =>
  Match.valueTags(event, {
    TurnQueued: ({ turn }) =>
      withQueue(model, turn.sessionId, (queue) =>
        queue.some((queued) => queued.id === turn.id) ? queue : [...queue, turn]
      ),
    QueuedTurnEdited: (e) =>
      withQueue(model, e.sessionId, (queue) =>
        queue.some((queued) => queued.id === e.turnId)
          ? queue.map((queued) =>
              queued.id === e.turnId
                ? new QueuedTurn({
                    id: queued.id,
                    sessionId: queued.sessionId,
                    prompt: e.prompt,
                    attachments: queued.attachments,
                    actor: queued.actor,
                    queuedAt: queued.queuedAt,
                    editedAt: at,
                    approves: queued.approves,
                  })
                : queued
            )
          : queue
      ),
    QueuedTurnCancelled: (e) => withQueue(model, e.sessionId, (queue) => without(queue, e.turnId)),
  });

/** A Turn starting leaves the queue it waited in. */
export const leftQueue = (model: ReadModel, sessionId: SessionId, turnId: TurnId): ReadModel =>
  withQueue(model, sessionId, (queue) => without(queue, turnId));
