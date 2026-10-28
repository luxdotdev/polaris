/**
 * A Client that didn't announce `actor.linked-device` can't decode the `LinkedDevice`
 * Actor, so it reads a Linked Device's commands as a Client's (ADR 0083).
 */
import {
  Actor,
  type Capability,
  DomainEvent,
  EventEnvelope,
  HostStreamItem,
  SessionStreamItem,
} from "@polaris/protocol";
import { Predicate } from "effect";

const CLIENT = Actor.cases.Client.make({});

const asClient = (actor: Actor | null | undefined) =>
  actor != null && Predicate.isTagged(actor, "LinkedDevice") ? CLIENT : actor;

const eventFor = (event: DomainEvent): DomainEvent =>
  DomainEvent.matchOrElse(
    event,
    {
      SessionCreated: (e) =>
        asClient(e.actor) === e.actor
          ? e
          : DomainEvent.cases.SessionCreated.make({ ...e, actor: CLIENT }),
      TurnStarted: (e) =>
        asClient(e.actor) === e.actor
          ? e
          : DomainEvent.cases.TurnStarted.make({ ...e, actor: CLIENT }),
      ApprovalResolved: (e) =>
        asClient(e.actor) === e.actor
          ? e
          : DomainEvent.cases.ApprovalResolved.make({ ...e, actor: CLIENT }),
    },
    () => event
  );

const envelopeFor = (envelope: EventEnvelope): EventEnvelope => {
  const event = eventFor(envelope.event);

  return event === envelope.event
    ? envelope
    : new EventEnvelope({
        sequence: envelope.sequence,
        occurredAt: envelope.occurredAt,
        commandId: envelope.commandId,
        event,
      });
};

const hostItem = (item: HostStreamItem): HostStreamItem =>
  Predicate.isTagged(item, "Event")
    ? HostStreamItem.cases.Event.make({ envelope: envelopeFor(item.envelope) })
    : item;

const sessionItem = (item: SessionStreamItem): SessionStreamItem =>
  Predicate.isTagged(item, "Event")
    ? SessionStreamItem.cases.Event.make({ envelope: envelopeFor(item.envelope) })
    : item;

/** Identity (null) for Clients that announced `actor.linked-device`. */
export const actorHostItemsFor = (capabilities: ReadonlyArray<Capability>) =>
  capabilities.includes("actor.linked-device") ? null : hostItem;

/** Identity (null) for Clients that announced `actor.linked-device`. */
export const actorSessionItemsFor = (capabilities: ReadonlyArray<Capability>) =>
  capabilities.includes("actor.linked-device") ? null : sessionItem;
