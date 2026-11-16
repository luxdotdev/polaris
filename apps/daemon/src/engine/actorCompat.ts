/**
 * A Client that didn't announce `actor.linked-device` or `actor.teammate` can't decode that
 * Actor, so it reads a Linked Device's or a Teammate's actions as a Client's (`actorFor`, ADR 0083).
 */
import {
  type Actor,
  actorFor,
  type Capability,
  type Comment,
  DomainEvent,
  EventEnvelope,
  HostStreamItem,
  SessionStreamItem,
  type Turn,
  TurnDetail,
  TurnPage,
} from "@polaris/protocol";
import { Predicate } from "effect";
import { patchComment } from "../store/comments.ts";
import { patchTurn } from "../store/patch.ts";

type Rewrite = (actor: Actor) => Actor;

const commentFor = (comment: Comment, rewrite: Rewrite): Comment => {
  const author = rewrite(comment.author);
  const resolvedBy = comment.resolvedBy == null ? comment.resolvedBy : rewrite(comment.resolvedBy);

  return author === comment.author && resolvedBy === comment.resolvedBy
    ? comment
    : patchComment(comment, { author, resolvedBy });
};

const turnFor = (turn: Turn, rewrite: Rewrite): Turn => {
  const actor = turn.actor == null ? turn.actor : rewrite(turn.actor);

  return actor === turn.actor ? turn : patchTurn(turn, { actor });
};

const detailFor = (detail: TurnDetail, rewrite: Rewrite): TurnDetail => {
  const turn = turnFor(detail.turn, rewrite);

  return turn === detail.turn
    ? detail
    : new TurnDetail({ turn, items: detail.items, subagents: detail.subagents });
};

/** `event` with its Actors rewritten; the same value when none changes. */
const eventFor = (event: DomainEvent, rewrite: Rewrite): DomainEvent => {
  const same = (actor: Actor | null | undefined) => actor == null || rewrite(actor) === actor;

  return DomainEvent.matchOrElse(
    event,
    {
      SessionCreated: (e) =>
        same(e.actor) || e.actor == null
          ? e
          : DomainEvent.cases.SessionCreated.make({ ...e, actor: rewrite(e.actor) }),
      TurnStarted: (e) => {
        const turn = turnFor(e.turn, rewrite);

        return (same(e.actor) || e.actor == null) && turn === e.turn
          ? e
          : DomainEvent.cases.TurnStarted.make({
              turn,
              actor: e.actor == null ? e.actor : rewrite(e.actor),
            });
      },
      TurnEnded: (e) => {
        const turn = turnFor(e.turn, rewrite);

        return turn === e.turn ? e : DomainEvent.cases.TurnEnded.make({ ...e, turn });
      },
      ApprovalResolved: (e) =>
        same(e.actor) || e.actor == null
          ? e
          : DomainEvent.cases.ApprovalResolved.make({ ...e, actor: rewrite(e.actor) }),
      CommentAdded: (e) => {
        const comment = commentFor(e.comment, rewrite);

        return comment === e.comment ? e : DomainEvent.cases.CommentAdded.make({ comment });
      },
      CommentEdited: (e) =>
        rewrite(e.actor) === e.actor
          ? e
          : DomainEvent.cases.CommentEdited.make({ ...e, actor: rewrite(e.actor) }),
      CommentResolved: (e) =>
        rewrite(e.actor) === e.actor
          ? e
          : DomainEvent.cases.CommentResolved.make({ ...e, actor: rewrite(e.actor) }),
      CommentReopened: (e) =>
        rewrite(e.actor) === e.actor
          ? e
          : DomainEvent.cases.CommentReopened.make({ ...e, actor: rewrite(e.actor) }),
    },
    () => event
  );
};

const envelopeFor = (envelope: EventEnvelope, rewrite: Rewrite): EventEnvelope => {
  const event = eventFor(envelope.event, rewrite);

  return event === envelope.event
    ? envelope
    : new EventEnvelope({
        sequence: envelope.sequence,
        occurredAt: envelope.occurredAt,
        commandId: envelope.commandId,
        event,
      });
};

/** Whether a Client with `capabilities` decodes every Actor variant. */
const decodesEveryActor = (capabilities: ReadonlyArray<Capability>) =>
  capabilities.includes("actor.linked-device") && capabilities.includes("actor.teammate");

const rewriteFor =
  (capabilities: ReadonlyArray<Capability>): Rewrite =>
  (actor) =>
    actorFor(actor, capabilities);

/** Identity (null) for Clients that decode every Actor. */
export const actorHostItemsFor = (capabilities: ReadonlyArray<Capability>) => {
  if (decodesEveryActor(capabilities)) return null;
  const rewrite = rewriteFor(capabilities);

  return (item: HostStreamItem): HostStreamItem =>
    Predicate.isTagged(item, "Event")
      ? HostStreamItem.cases.Event.make({ envelope: envelopeFor(item.envelope, rewrite) })
      : item;
};

/** Identity (null) for Clients that decode every Actor: a `session.turns` page's Turn authors. */
export const actorTurnPageFor = (capabilities: ReadonlyArray<Capability>) => {
  if (decodesEveryActor(capabilities)) return null;
  const rewrite = rewriteFor(capabilities);

  return (page: TurnPage): TurnPage =>
    new TurnPage({
      turns: page.turns.map((detail) => detailFor(detail, rewrite)),
      sequence: page.sequence,
      hasMore: page.hasMore,
    });
};

/** Identity (null) for Clients that decode every Actor; a snapshot's Turns and Comments too. */
export const actorSessionItemsFor = (capabilities: ReadonlyArray<Capability>) => {
  if (decodesEveryActor(capabilities)) return null;
  const rewrite = rewriteFor(capabilities);

  return (item: SessionStreamItem): SessionStreamItem =>
    SessionStreamItem.matchOrElse(
      item,
      {
        Event: (e) =>
          SessionStreamItem.cases.Event.make({ envelope: envelopeFor(e.envelope, rewrite) }),
        Snapshot: (s) =>
          SessionStreamItem.cases.Snapshot.make({
            ...s,
            turns: s.turns.map((detail) => detailFor(detail, rewrite)),
            comments: s.comments.map((comment) => commentFor(comment, rewrite)),
          }),
      },
      () => item
    );
};
