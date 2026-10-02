import type { SessionId } from "@polaris/protocol";
import { Match, Predicate } from "effect";
import type { ConstellationRecord } from "../../store/constellation.ts";
import { inputDeliveryKey } from "../../store/constellation.ts";

export interface PendingInput {
  readonly id: string;
  readonly sessionId: SessionId;
  readonly text: string;
}

const operatorText = (
  message: ConstellationRecord["messages"] extends ReadonlyMap<string, infer M> ? M : never
) => {
  const authority = Match.value(message.authority).pipe(
    Match.when("conversation", () => "Ordinary conversation. No additional decision authority."),
    Match.when(
      "recommend_and_return",
      () => "Recommend a course of action, then return the decision to the user."
    ),
    Match.when(
      "may_decide_and_continue",
      () => "The user authorizes you to decide this matter and continue."
    ),
    Match.exhaustive
  );

  return `Polaris operator message · ${message.id}\n${authority}\n\n${message.text}`;
};

export const pendingInputs = (record: ConstellationRecord): ReadonlyArray<PendingInput> => {
  const inputs: Array<PendingInput> = [];

  for (const message of record.messages.values()) {
    const sessions = Predicate.isTagged(message.target, "Lead")
      ? [record.graph.leadSessionId]
      : (record.messageTargets.get(message.id) ?? []);

    for (const sessionId of sessions)
      inputs.push({ id: message.id, sessionId, text: operatorText(message) });
  }

  for (const [id, peer] of record.peers) {
    const target = record.graph.attempts.find((a) => a.id === peer.to);
    const from = record.graph.attempts.find((a) => a.id === peer.from);

    if (target !== undefined)
      inputs.push({
        id,
        sessionId: target.sessionId,
        text: `Polaris peer message from ${from?.taskId ?? peer.from}\n\n${peer.text}`,
      });
  }

  return inputs.filter((i) => !record.inputDeliveries.has(inputDeliveryKey(i.id, i.sessionId)));
};
