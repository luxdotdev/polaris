/**
 * A Client that didn't announce `session.limited` can't decode the Limited state, so it
 * reads a Limited session as Failed, with the usage limit as the error.
 */
import {
  type AgentSession,
  type Capability,
  DomainEvent,
  EventEnvelope,
  type HostStreamItem,
  SessionStreamItem,
  SessionSummary,
  HostStreamItem as HostItem,
} from "@polaris/protocol";
import { Predicate } from "effect";
import { patchSession } from "../store/model.ts";

const USAGE_LIMIT = "Usage limit";

const asFailed = (session: AgentSession): AgentSession =>
  session.state === "limited"
    ? patchSession(session, { state: "failed", lastError: session.lastError ?? USAGE_LIMIT })
    : session;

const eventFor = (event: DomainEvent): DomainEvent =>
  Predicate.isTagged(event, "SessionStateChanged") && event.state === "limited"
    ? DomainEvent.cases.SessionStateChanged.make({
        sessionId: event.sessionId,
        state: "failed",
        reason: event.reason ?? USAGE_LIMIT,
      })
    : event;

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

const hostItem = (item: HostStreamItem): HostStreamItem => {
  if (Predicate.isTagged(item, "Event"))
    return HostItem.cases.Event.make({ envelope: envelopeFor(item.envelope) });

  if (!Predicate.isTagged(item, "Snapshot")) return item;

  return HostItem.cases.Snapshot.make({
    ...item,
    sessions: item.sessions.map(
      (summary) =>
        new SessionSummary({
          session: asFailed(summary.session),
          pendingApprovals: summary.pendingApprovals,
          lastTurnPreview: summary.lastTurnPreview,
          subagents: summary.subagents,
        })
    ),
  });
};

const sessionItem = (item: SessionStreamItem): SessionStreamItem =>
  Predicate.isTagged(item, "Snapshot")
    ? SessionStreamItem.cases.Snapshot.make({ ...item, session: asFailed(item.session) })
    : Predicate.isTagged(item, "Event")
      ? SessionStreamItem.cases.Event.make({ envelope: envelopeFor(item.envelope) })
      : item;

/** Identity for Clients that announced `session.limited`. */
export const hostItemsFor = (capabilities: ReadonlyArray<Capability>) =>
  capabilities.includes("session.limited") ? null : hostItem;

/** Identity for Clients that announced `session.limited`. */
export const sessionItemsFor = (capabilities: ReadonlyArray<Capability>) =>
  capabilities.includes("session.limited") ? null : sessionItem;
