import {
  CommandId,
  CommandRejected,
  type RemoteDeliveryPacket,
  type RemoteWorkerAssignment,
} from "@polaris/protocol";
import { Effect, Predicate } from "effect";
import type { ReadModel } from "../../store/model.ts";

/** Validate the worker Host's durable mirror before applying a delivery. */
export const validateRemoteDelivery = (
  packet: RemoteDeliveryPacket,
  model: ReadModel,
  assignments: ReadonlyArray<RemoteWorkerAssignment>
) => {
  const assignment = assignments.find(
    (a) =>
      a.attemptId === packet.attemptId &&
      a.graph.id === packet.constellationId &&
      a.graph.hostId === packet.ownerHostId
  );

  const attempt = assignment?.graph.attempts.find((a) => a.id === packet.attemptId);
  const unblock = Predicate.isTagged(packet.input, "Turn") && packet.input.cause === "unblock";

  return attempt?.sessionId === packet.sessionId &&
    attempt.hostId === packet.workerHostId &&
    (attempt.state === "working" || (attempt.state === "blocked" && unblock)) &&
    assignment?.graph.state !== "archived" &&
    model.sessions.has(packet.sessionId)
    ? Effect.void
    : Effect.fail(
        new CommandRejected({
          commandId: CommandId.make(packet.id),
          reason: "The input is not for an active remote worker",
        })
      );
};
