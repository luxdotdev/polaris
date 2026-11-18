/**
 * A shared session's queued Turns (ENG-941) as the thread folds them: the Snapshot's queue, then
 * each queue event; a queued Turn leaves when it starts or is cancelled.
 */
import { type DomainEvent, QueuedTurn } from "@polaris/protocol";
import { Match } from "effect";

type Queue = ReadonlyArray<QueuedTurn>;

const without = (queue: Queue, turnId: string): Queue =>
  queue.some((q) => q.id === turnId) ? queue.filter((q) => q.id !== turnId) : queue;

const edited = (queued: QueuedTurn, prompt: string, at: string) =>
  new QueuedTurn({
    id: queued.id,
    sessionId: queued.sessionId,
    prompt,
    attachments: queued.attachments,
    actor: queued.actor,
    queuedAt: queued.queuedAt,
    editedAt: at,
    approves: queued.approves,
  });

/** `queue` after `event`, which happened `at`; the same array for events that change none. */
export const foldQueue = (queue: Queue, event: DomainEvent, at: string): Queue =>
  Match.value(event).pipe(
    Match.tags({
      TurnQueued: ({ turn }) => [...queue.filter((q) => q.id !== turn.id), turn],
      QueuedTurnEdited: ({ turnId, prompt }) =>
        queue.map((q) => (q.id === turnId ? edited(q, prompt, at) : q)),
      QueuedTurnCancelled: ({ turnId }) => without(queue, turnId),
      TurnStarted: ({ turn }) => without(queue, turn.id),
    }),
    Match.orElse(() => queue)
  );
