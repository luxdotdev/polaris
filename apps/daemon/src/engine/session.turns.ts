import { DomainEvent, Turn, type TurnId, type TurnTrigger } from "@polaris/protocol";
import { workingTurn, type SessionRecord } from "../store/model.ts";

/** Turns started by the Harness itself, including background reports and terminal input. */
export const harnessTurn = (
  record: SessionRecord,
  event: { turnId: TurnId; prompt: string; at: string; trigger: TurnTrigger | null }
): DomainEvent | null =>
  (event.trigger !== null &&
    (record.session.state !== "idle" || workingTurn(record) !== undefined)) ||
  record.turns.some((t) => t.id === event.turnId)
    ? null
    : DomainEvent.cases.TurnStarted.make({
        turn: new Turn({
          id: event.turnId,
          sessionId: record.session.id,
          index: record.session.turnCount,
          prompt: event.trigger === null ? event.prompt : "[Background task continuation]",
          trigger: event.trigger,
          attachments: [],
          model: record.session.model,
          effort: record.session.effort,
          serviceTier: record.session.serviceTier,
          status: "working",
          checkpointBefore: null,
          checkpointAfter: null,
          startedAt: event.at,
          endedAt: null,
        }),
      });
