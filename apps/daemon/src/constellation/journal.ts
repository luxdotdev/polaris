import {
  ConstellationEvent,
  type DomainEvent,
  type AttemptId,
  type SessionId,
  type TurnId,
  NotificationItem,
} from "@polaris/protocol";
import { Predicate } from "effect";
import type { ConstellationContext } from "../engine/constellation.inputs.ts";
import type { ConstellationDecision } from "../engine/constellation.ts";
import type { ConstellationRecord } from "../store/constellation.ts";
import { currentAttempt } from "./attempts.ts";
import { GraphDecision, refusal } from "./decision.ts";

/** Trusted Daemon inputs; these are never accepted from an RPC payload. */
export type ConstellationJournalInput =
  | {
      readonly type: "settle";
      readonly attemptId: AttemptId;
      readonly outcome: "lost" | "settled_unverified" | "failed";
      readonly reason: string;
    }
  | {
      readonly type: "notified";
      readonly leadSessionId: SessionId;
      readonly items: ReadonlyArray<string>;
      readonly turnId: TurnId;
      readonly turnEvents: ReadonlyArray<DomainEvent>;
    }
  | {
      readonly type: "nudged";
      readonly attemptId: AttemptId;
      readonly turnId: TurnId;
      readonly turnEvents: ReadonlyArray<DomainEvent>;
    }
  | { readonly type: "messageResolved"; readonly id: string }
  | {
      readonly type: "recoveryContinued";
      readonly attemptId: AttemptId;
      readonly turnId: TurnId;
      readonly interruptionId: string;
      readonly turnEvents: ReadonlyArray<DomainEvent>;
    };

const hasTurn = (events: ReadonlyArray<DomainEvent>, sessionId: SessionId, turnId: TurnId) =>
  events.some(
    (e) =>
      Predicate.isTagged(e, "TurnStarted") && e.turn.sessionId === sessionId && e.turn.id === turnId
  );

const notified = (
  d: GraphDecision,
  input: Extract<ConstellationJournalInput, { type: "notified" }>
) => {
  if (
    input.leadSessionId !== d.record.graph.leadSessionId ||
    d.record.graph.state === "paused" ||
    d.record.graph.state === "archived"
  )
    d.reject(
      "E-DELIVERY-LEAD",
      "The current Lead cannot receive this digest",
      "Keep the notifications queued for the current Lead."
    );
  const pending = new Set(d.record.graph.pendingNotifications.map((n) => n.id));

  if (
    input.items.length === 0 ||
    new Set(input.items).size !== input.items.length ||
    input.items.some((id) => !pending.has(id))
  )
    d.reject(
      "E-DELIVERY-ITEMS",
      "Delivery contains unknown or already delivered items",
      "Deliver each pending notification once."
    );

  if (!hasTurn(input.turnEvents, input.leadSessionId, input.turnId))
    d.reject(
      "E-DELIVERY-TURN",
      "Delivery requires its session-machine TurnStarted in this commit",
      "Commit the digest Turn and LeadNotified atomically."
    );

  d.emit(
    ConstellationEvent.cases.LeadNotified.make({
      ...d.fields(),
      leadSessionId: input.leadSessionId,
      items: [...input.items],
      turnId: input.turnId,
    })
  );
};

const recoveryContinued = (
  d: GraphDecision,
  input: Extract<ConstellationJournalInput, { type: "recoveryContinued" }>
): ReadonlyArray<DomainEvent> => {
  const key = JSON.stringify([input.attemptId, input.interruptionId]);

  if (d.record.recoveries.has(key)) return [];

  const attempt = currentAttempt(d, input.attemptId);

  if ([...d.record.recoveries].some((id) => id.startsWith(`[${JSON.stringify(input.attemptId)},`)))
    d.reject(
      "E-RECOVERY-LIMIT",
      "This Attempt has already been automatically continued",
      "Show attention for the user to continue or send back."
    );

  if (
    attempt !== undefined &&
    (attempt.state !== "working" || !hasTurn(input.turnEvents, attempt.sessionId, input.turnId))
  )
    d.reject(
      "E-RECOVERY-TURN",
      "Recovery requires the working Attempt's session-machine TurnStarted",
      "Commit its Continue and recovery marker atomically."
    );

  if (attempt !== undefined)
    d.emit(
      ConstellationEvent.cases.AttemptRecoveryContinued.make({
        ...d.fields(),
        attemptId: attempt.id,
        attemptRevision: attempt.revision + 1,
        turnId: input.turnId,
        interruptionId: input.interruptionId,
        cause: "recover",
      })
    );

  return input.turnEvents;
};

const settle = (
  d: GraphDecision,
  input: Extract<ConstellationJournalInput, { type: "settle" }>,
  ctx: ConstellationContext
) => {
  const attempt = currentAttempt(d, input.attemptId);

  if (attempt !== undefined) {
    if (ctx.offlineSessionIds.has(attempt.sessionId) && !ctx.commanded)
      d.reject(
        "E-STALE",
        "An offline worker cannot settle mechanically",
        "Keep it stale until the Host returns or the user or Lead issues a command."
      );
    d.emit(
      ConstellationEvent.cases.AttemptSettled.make({
        ...d.fields(),
        attemptId: attempt.id,
        attemptRevision: attempt.revision + 1,
        outcome: input.outcome,
        reason: input.reason,
      })
    );
    d.notify(NotificationItem.cases.Settled.make({ attemptId: attempt.id, state: input.outcome }));
  }
};

const nudged = (
  d: GraphDecision,
  input: Extract<ConstellationJournalInput, { type: "nudged" }>,
  ctx: ConstellationContext
): ReadonlyArray<DomainEvent> => {
  if (d.record.graph.attempts.some((a) => a.id === input.attemptId && a.nudgedAt !== null))
    return [];

  const attempt = currentAttempt(d, input.attemptId);

  if (attempt !== undefined && attempt.nudgedAt === null) {
    if (attempt.state !== "working" || !hasTurn(input.turnEvents, attempt.sessionId, input.turnId))
      d.reject(
        "E-NUDGE-TURN",
        "A nudge requires the working Attempt's session-machine TurnStarted",
        "Commit the nudge Turn and marker atomically."
      );
    else {
      d.emit(
        ConstellationEvent.cases.AttemptNudged.make({
          ...d.fields(),
          attemptId: attempt.id,
          attemptRevision: attempt.revision + 1,
          at: ctx.now,
        })
      );

      return input.turnEvents;
    }
  }

  return [];
};

/** Delivery/recovery markers commit in the same batch as their session-machine Turn events. */
export const decideConstellationJournal = (
  record: ConstellationRecord,
  input: ConstellationJournalInput,
  ctx: ConstellationContext
): ConstellationDecision => {
  const d = new GraphDecision(record, ctx);

  if (record.graph.hostId !== ctx.hostId)
    d.reject(
      "E-OWNER",
      "Only the owning Daemon may write the journal",
      "Relay to the Lead's Host."
    );
  let companion: ReadonlyArray<DomainEvent> = [];

  switch (input.type) {
    case "settle":
      settle(d, input, ctx);
      break;
    case "nudged":
      companion = nudged(d, input, ctx);
      break;

    case "notified":
      notified(d, input);
      companion = input.turnEvents;
      break;

    case "messageResolved":
      if (!record.messages.has(input.id))
        d.reject(
          "E-MESSAGE",
          "The message is unknown or already resolved",
          "Resolve a message still in transit."
        );
      else
        d.emit(
          ConstellationEvent.cases.OperatorMessageResolved.make({ ...d.fields(), id: input.id })
        );
      break;
    case "recoveryContinued":
      companion = recoveryContinued(d, input);
      break;
  }

  return d.findings.length > 0
    ? { events: [], rejection: refusal(record, d.findings) }
    : { events: [...companion, ...d.events], rejection: null };
};
