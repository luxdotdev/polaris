import { DomainEvent, TurnItem } from "@polaris/protocol";
import { workingTurn, type SessionRecord } from "../store/model.ts";
import type { SessionInput } from "./session.inputs.ts";

type DeferredInput = Extract<SessionInput, { type: "turn.deliver" }>;

/** The machine handles deferred input independently of the original steer target. */
export const deferredDelivery = (record: SessionRecord, input: DeferredInput) => {
  const refusal =
    input.refusal ?? (record.session.state === "archived" ? "the session is Archived" : null);

  const working = workingTurn(record);

  if (refusal === null && working !== undefined) return { waiting: working.id, refusal: null };

  return { waiting: null, refusal };
};

export const refusedInput = (
  record: SessionRecord | undefined,
  input: DeferredInput,
  reason: string
) => [
  DomainEvent.cases.TurnItemCompleted.make({
    sessionId: record?.session.id ?? input.turn.sessionId,
    turnId: input.targetTurnId,
    subagentId: null,
    item: TurnItem.cases.UserMessage.make({
      id: `refused:${input.turn.id}`,
      text: input.turn.prompt,
    }),
  }),
  DomainEvent.cases.TurnItemCompleted.make({
    sessionId: record?.session.id ?? input.turn.sessionId,
    turnId: input.targetTurnId,
    subagentId: null,
    item: TurnItem.cases.Error.make({
      id: `refusal:${input.turn.id}`,
      message: `Could not deliver the queued prompt: ${reason}`,
    }),
  }),
];
