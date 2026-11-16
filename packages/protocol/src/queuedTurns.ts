/**
 * Queued Turns (ENG-941): in a shared Agent Session, a Turn sent while another is in flight
 * waits in the session's queue, first in first out, and starts when the Turn before it ends.
 * Capability `session.queued-turns`; Clients that announced it get the queue in the session
 * snapshot and its events.
 */
import { Predicate, Schema } from "effect";
import { sameActor } from "./comments.ts";
import { Attachment } from "./domain.ts";
import { Actor } from "./extensions.ts";
import { SessionId, Timestamp, TurnId } from "./ids.ts";
import { optionalNullable } from "./models.ts";

/** A Turn waiting its turn. `id` becomes the Turn's id when it starts. */
export class QueuedTurn extends Schema.Class<QueuedTurn>("QueuedTurn")({
  id: TurnId,
  sessionId: SessionId,
  prompt: Schema.String,
  attachments: Schema.Array(Attachment),
  /** Who sent it; the Turn it becomes keeps this Actor. */
  actor: Actor,
  queuedAt: Timestamp,
  editedAt: optionalNullable(Timestamp),
  /** False when its sender did not hold `approve` as it queued (`queuedTurnMayStart`). */
  approves: optionalNullable(Schema.Boolean),
}) {}

/** The queue's events on the session's log (`events.ts`). A queued Turn starting is its `TurnStarted`. */
export const queuedTurnEventFields = {
  /** `SendTurn` while a Turn is in flight in a shared session: `turn` joins the end of the queue. */
  TurnQueued: { turn: QueuedTurn },
  /** `EditQueuedTurn`: its author or the owner changed the prompt; its place is kept. */
  QueuedTurnEdited: {
    sessionId: SessionId,
    turnId: TurnId,
    prompt: Schema.String,
    actor: Actor,
  },
  /**
   * The queued Turn will not start. `actor` is who cancelled it (`CancelQueuedTurn`); null
   * when the Host dropped it with `reason`, because the Turn in flight did not end cleanly.
   */
  QueuedTurnCancelled: {
    sessionId: SessionId,
    turnId: TurnId,
    actor: Schema.NullOr(Actor),
    reason: Schema.NullOr(Schema.String),
  },
};

/**
 * Whether `actor` may cancel or edit `queued`: its author, or the owner (any Actor that is
 * not a Teammate).
 */
export const mayChangeQueuedTurn = (queued: QueuedTurn, actor: Actor): boolean =>
  !Predicate.isTagged(actor, "Teammate") || sameActor(queued.actor, actor);
