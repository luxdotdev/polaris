/**
 * What a Constellation's stream Snapshot carries besides the graph: pending proposals,
 * progress notes, unresolved operator messages, digests and handovers, folded by the owner.
 */
import { Schema } from "effect";
import { SessionId, Timestamp, TurnId } from "../ids.ts";
import { MessageAuthority, MessageTarget } from "./commands.ts";
import {
  AttemptId,
  ConstellationNotification,
  Revision,
  TaskDefinition,
  TaskProjection,
} from "./domain.ts";

/** A Task proposed by an Attempt and not yet answered. */
export class ConstellationProposal extends Schema.Class<ConstellationProposal>(
  "ConstellationProposal"
)({
  proposalId: Schema.String,
  by: AttemptId,
  task: TaskDefinition,
  at: Timestamp,
}) {}

/** A worker's latest progress note (AttemptProgressed). */
export class AttemptProgress extends Schema.Class<AttemptProgress>("ConstellationAttemptProgress")({
  attemptId: AttemptId,
  note: Schema.String,
  completed: Schema.NullOr(Revision),
  total: Schema.NullOr(Revision),
  at: Timestamp,
}) {}

/** An operator message not yet resolved (delivered). */
export class PendingOperatorMessage extends Schema.Class<PendingOperatorMessage>(
  "ConstellationPendingOperatorMessage"
)({
  id: Schema.String,
  authority: MessageAuthority,
  target: MessageTarget,
  text: Schema.String,
  at: Timestamp,
}) {}

/** One digest Turn (LeadNotified) with the notifications it delivered. */
export class ConstellationDigest extends Schema.Class<ConstellationDigest>("ConstellationDigest")({
  turnId: TurnId,
  leadSessionId: SessionId,
  revision: Revision,
  at: Timestamp,
  items: Schema.Array(ConstellationNotification),
}) {}

/** A handover (LeadChanged) and the graph as it stood at the switch (C9's structured part). */
export class ConstellationHandover extends Schema.Class<ConstellationHandover>(
  "ConstellationHandover"
)({
  from: SessionId,
  to: SessionId,
  summary: Schema.String,
  revision: Revision,
  at: Timestamp,
  projections: Schema.Array(TaskProjection),
  inFlight: Schema.Array(AttemptId),
  questions: Schema.Array(ConstellationNotification),
  undelivered: Schema.Array(PendingOperatorMessage),
}) {}
