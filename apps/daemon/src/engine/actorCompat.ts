/**
 * A Client that didn't announce `actor.linked-device` or `actor.teammate` can't decode that
 * Actor, so it reads such a command as a Client's (ADR 0083, ADR 0112; `actorFor`).
 */
import {
  type Actor,
  actorFor,
  type Capability,
  DomainEvent,
  EventEnvelope,
  HostStreamItem,
  SessionStreamItem,
} from "@polaris/protocol";
import { Predicate } from "effect";

type Degrade = (actor: Actor) => Actor;

const eventFor = (event: DomainEvent, degrade: Degrade): DomainEvent => {
  const known = (actor: Actor | null | undefined) =>
    actor == null || degrade(actor) === actor ? null : degrade(actor);

  return DomainEvent.matchOrElse(
    event,
    {
      SessionCreated: (e) => {
        const actor = known(e.actor);

        return actor === null ? e : DomainEvent.cases.SessionCreated.make({ ...e, actor });
      },
      TurnStarted: (e) => {
        const actor = known(e.actor);

        return actor === null ? e : DomainEvent.cases.TurnStarted.make({ ...e, actor });
      },
      ApprovalResolved: (e) => {
        const actor = known(e.actor);

        return actor === null ? e : DomainEvent.cases.ApprovalResolved.make({ ...e, actor });
      },
    },
    () => event
  );
};

const envelopeFor = (envelope: EventEnvelope, degrade: Degrade): EventEnvelope => {
  const event = eventFor(envelope.event, degrade);

  return event === envelope.event
    ? envelope
    : new EventEnvelope({
        sequence: envelope.sequence,
        occurredAt: envelope.occurredAt,
        commandId: envelope.commandId,
        event,
      });
};

/** Null when the Client decodes every Actor; else the Actor as it can read it. */
const degradeFor = (capabilities: ReadonlyArray<Capability>): Degrade | null =>
  capabilities.includes("actor.linked-device") && capabilities.includes("actor.teammate")
    ? null
    : (actor) => actorFor(actor, capabilities);

/** Identity (null) for Clients that announced both Actor capabilities. */
export const actorHostItemsFor = (capabilities: ReadonlyArray<Capability>) => {
  const degrade = degradeFor(capabilities);

  return degrade === null
    ? null
    : (item: HostStreamItem): HostStreamItem =>
        Predicate.isTagged(item, "Event")
          ? HostStreamItem.cases.Event.make({ envelope: envelopeFor(item.envelope, degrade) })
          : item;
};

/** Identity (null) for Clients that announced both Actor capabilities. */
export const actorSessionItemsFor = (capabilities: ReadonlyArray<Capability>) => {
  const degrade = degradeFor(capabilities);

  return degrade === null
    ? null
    : (item: SessionStreamItem): SessionStreamItem =>
        Predicate.isTagged(item, "Event")
          ? SessionStreamItem.cases.Event.make({ envelope: envelopeFor(item.envelope, degrade) })
          : item;
};
