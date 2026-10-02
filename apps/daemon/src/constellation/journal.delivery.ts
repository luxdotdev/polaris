import { ConstellationEvent, type DomainEvent, type SessionId } from "@polaris/protocol";
import { Predicate } from "effect";
import { inputDeliveryKey } from "../store/constellation.ts";
import { activeAttempt } from "./projections.ts";
import { stopLeadGates } from "./handover/gates.ts";
import type { GraphDecision } from "./decision.ts";
import type { ConstellationJournalInput } from "./journal.ts";

export const messageRecipients = (d: GraphDecision, id: string): ReadonlyArray<SessionId> => {
  const message = d.record.messages.get(id);

  if (message === undefined) {
    const peer = d.record.peers.get(id);
    const attempt = d.record.graph.attempts.find((a) => a.id === peer?.to);

    return attempt === undefined ? [] : [attempt.sessionId];
  }

  if (Predicate.isTagged(message.target, "Lead")) return [d.record.graph.leadSessionId];

  return d.record.messageTargets.get(id) ?? [];
};

export const inputDelivered = (
  d: GraphDecision,
  input: Extract<ConstellationJournalInput, { type: "inputDelivered" }>
) => {
  if (d.record.inputDeliveries.has(inputDeliveryKey(input.id, input.sessionId))) return [];
  const recipients = messageRecipients(d, input.id);

  if (!recipients.includes(input.sessionId)) {
    d.reject(
      "E-MESSAGE-TARGET",
      "The input does not belong to this Session",
      "Keep it queued for its intended recipient."
    );

    return [];
  }

  d.emit(
    ConstellationEvent.cases.WorkerInputDelivered.make({
      ...d.fields(),
      id: input.id,
      sessionId: input.sessionId,
      at: d.ctx.now,
    })
  );

  if (
    d.record.messages.has(input.id) &&
    recipients.every((id) => d.record.inputDeliveries.has(inputDeliveryKey(input.id, id)))
  )
    d.emit(ConstellationEvent.cases.OperatorMessageResolved.make({ ...d.fields(), id: input.id }));

  return input.turnEvents;
};

export const connectionObserved = (
  d: GraphDecision,
  input: Extract<ConstellationJournalInput, { type: "connection" }>
) => {
  const attempt = d.record.graph.attempts.find((a) => a.id === input.attemptId);

  if (attempt === undefined || !activeAttempt(attempt)) return;

  if (input.offline && !d.record.stale.has(attempt.id))
    d.emit(
      ConstellationEvent.cases.AttemptStale.make({
        ...d.fields(),
        attemptId: attempt.id,
        hostId: attempt.hostId,
        at: d.ctx.now,
      })
    );

  if (!input.offline && d.record.stale.has(attempt.id))
    d.emit(
      ConstellationEvent.cases.AttemptFresh.make({
        ...d.fields(),
        attemptId: attempt.id,
        at: d.ctx.now,
      })
    );
};

export const handoverCompleted = (
  d: GraphDecision,
  input: Extract<ConstellationJournalInput, { type: "handoverCompleted" }>
): ReadonlyArray<DomainEvent> => {
  const request = d.record.handoverRequest;

  if (
    request?.requestId !== input.requestId ||
    request.from !== d.record.graph.leadSessionId ||
    d.record.graph.state === "completed" ||
    d.record.graph.state === "archived"
  )
    return [];
  const to = d.ctx.newLeadSessionId;

  if (
    to === null ||
    to === request.from ||
    d.ctx.occupiedSessions.has(to) ||
    d.record.graph.attempts.some((a) => activeAttempt(a) && a.sessionId === to)
  ) {
    d.reject(
      "E-LEAD",
      "Handover requires a fresh Lead Session",
      "Prepare a fresh Session in the same checkout."
    );

    return [];
  }

  if (
    !input.turnEvents.some((e) => Predicate.isTagged(e, "TurnStarted") && e.turn.sessionId === to)
  ) {
    d.reject(
      "E-HANDOVER-TURN",
      "Handover requires the new Lead's first Turn",
      "Commit the header Turn with LeadChanged."
    );

    return [];
  }

  stopLeadGates(d);

  d.emit(
    ConstellationEvent.cases.LeadChanged.make({
      ...d.fields(),
      from: request.from,
      to,
      summary: input.summary,
      requestId: request.requestId,
    })
  );

  return input.turnEvents;
};
