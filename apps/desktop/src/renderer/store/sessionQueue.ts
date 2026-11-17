/**
 * An Agent Session's queued Turns (ENG-941) as the renderer folds them: the snapshot's queue,
 * then each queue event; a queued Turn leaves the queue when it starts or is cancelled.
 */
import type { DomainEvent, EventEnvelope, QueuedTurn } from "@polaris/protocol";
import { Match } from "effect";
import type { Plain } from "./plain.ts";

export type SessionQueuedTurn = Plain<QueuedTurn>;

type Queue = ReadonlyArray<SessionQueuedTurn>;

const without = (queue: Queue, turnId: string): Queue =>
  queue.some((q) => q.id === turnId) ? queue.filter((q) => q.id !== turnId) : queue;

/** `queue` after `envelope`; the same array for events that change none. */
export const foldQueue = (queue: Queue, envelope: EventEnvelope): Queue =>
  Match.value<DomainEvent>(envelope.event).pipe(
    Match.tags({
      TurnQueued: ({ turn }) => [...queue.filter((q) => q.id !== turn.id), turn],
      QueuedTurnEdited: ({ turnId, prompt }) =>
        queue.map((q) => (q.id === turnId ? { ...q, prompt, editedAt: envelope.occurredAt } : q)),
      QueuedTurnCancelled: ({ turnId }) => without(queue, turnId),
      TurnStarted: ({ turn }) => without(queue, turn.id),
    }),
    Match.orElse(() => queue)
  );
