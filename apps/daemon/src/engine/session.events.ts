/** The domain events the Session machine builds from a folded record. */
import {
  DomainEvent,
  type SessionId,
  type SessionState,
  type Turn,
  type TurnId,
} from "@polaris/protocol";
import { patchTurn, type SessionRecord } from "../store/model.ts";

export const stateChanged = (
  sessionId: SessionId,
  state: SessionState,
  reason: string | null = null,
  resetsAt: string | null = null
): DomainEvent =>
  state === "limited"
    ? DomainEvent.cases.SessionStateChanged.make({ sessionId, state, reason, resetsAt })
    : DomainEvent.cases.SessionStateChanged.make({ sessionId, state, reason });

export const endTurn = (
  turn: Turn,
  status: "completed" | "interrupted" | "failed",
  endedAt: string,
  checkpointAfter: string | null = turn.checkpointAfter
): DomainEvent =>
  DomainEvent.cases.TurnEnded.make({
    turn: patchTurn(turn, { status, endedAt, checkpointAfter }),
  });

export const withdrawPending = (
  record: SessionRecord,
  withdrawnBy: "harness" | "daemon",
  reason: string,
  onlyTurn?: TurnId
): Array<DomainEvent> =>
  [...record.pending.values()].flatMap((request) =>
    onlyTurn === undefined || request.turnId === onlyTurn
      ? [
          DomainEvent.cases.ApprovalWithdrawn.make({
            sessionId: record.session.id,
            requestId: request.id,
            withdrawnBy,
            reason,
          }),
        ]
      : []
  );

export const RECOVERY_REASON = {
  restart: "The Daemon restarted",
  upgrade: "The Daemon is upgrading",
} as const;
