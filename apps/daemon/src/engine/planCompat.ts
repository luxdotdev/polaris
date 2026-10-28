/**
 * A Client that didn't announce `session.plan-mode` can't decode the `plan` PermissionMode,
 * so it reads a planning session as supervised: both ask before every edit.
 */
import {
  type AgentSession,
  type Capability,
  DomainEvent,
  EventEnvelope,
  HostStreamItem,
  SessionStreamItem,
  SessionSummary,
} from "@polaris/protocol";
import { Predicate } from "effect";
import { patchSession } from "../store/model.ts";

const asSupervised = (session: AgentSession): AgentSession =>
  session.permissionMode === "plan"
    ? patchSession(session, { permissionMode: "supervised" })
    : session;

const eventFor = (event: DomainEvent): DomainEvent =>
  DomainEvent.matchOrElse(
    event,
    {
      SessionCreated: (e) =>
        e.session.permissionMode === "plan"
          ? DomainEvent.cases.SessionCreated.make({ ...e, session: asSupervised(e.session) })
          : e,
      SessionPermissionModeChanged: (e) =>
        e.permissionMode === "plan"
          ? DomainEvent.cases.SessionPermissionModeChanged.make({
              ...e,
              permissionMode: "supervised",
            })
          : e,
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

const hostItem = (item: HostStreamItem): HostStreamItem => {
  if (Predicate.isTagged(item, "Event"))
    return HostStreamItem.cases.Event.make({ envelope: envelopeFor(item.envelope) });

  if (!Predicate.isTagged(item, "Snapshot")) return item;

  return HostStreamItem.cases.Snapshot.make({
    ...item,
    sessions: item.sessions.map((summary) =>
      summary.session.permissionMode === "plan"
        ? new SessionSummary({
            session: asSupervised(summary.session),
            pendingApprovals: summary.pendingApprovals,
            lastTurnPreview: summary.lastTurnPreview,
            subagents: summary.subagents,
          })
        : summary
    ),
  });
};

const sessionItem = (item: SessionStreamItem): SessionStreamItem =>
  Predicate.isTagged(item, "Snapshot")
    ? SessionStreamItem.cases.Snapshot.make({ ...item, session: asSupervised(item.session) })
    : Predicate.isTagged(item, "Event")
      ? SessionStreamItem.cases.Event.make({ envelope: envelopeFor(item.envelope) })
      : item;

/** Identity (null) for Clients that announced `session.plan-mode`. */
export const planHostItemsFor = (capabilities: ReadonlyArray<Capability>) =>
  capabilities.includes("session.plan-mode") ? null : hostItem;

/** Identity (null) for Clients that announced `session.plan-mode`. */
export const planSessionItemsFor = (capabilities: ReadonlyArray<Capability>) =>
  capabilities.includes("session.plan-mode") ? null : sessionItem;
