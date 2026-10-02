import {
  CommandId,
  ConstellationCommand,
  ConstellationOutboxEntry,
  ConstellationOutboxPacket,
  ConstellationRelayReceipt,
  ConstellationResult,
  ConstellationSettings,
  type ConstellationRejected,
  type Attempt,
  type RemoteWorkerAssignment,
} from "@polaris/protocol";
import {
  Context,
  Effect,
  Layer,
  Predicate,
  Schema,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";
import { EventStore } from "../../store/EventStore.ts";
import { graphResult } from "../service.ts";
import { decideConstellation } from "../../engine/constellation.ts";
import { ConstellationRuntime, ConstellationOwner } from "../runtime.ts";
import type { ConstellationBinding } from "../../engine/constellation.inputs.ts";
import { ConstellationWorktrees, transferError } from "../worktrees.ts";
import { collectClaimFacts } from "./claimFacts.ts";
import { RemoteWorkers } from "./assignments.ts";
import { TransferStorage, decodeReceipt, encodeReceipt } from "./storage.ts";

export interface RelayFactsService {
  readonly packet: ConstellationOutboxPacket | null;
}

export class RelayFacts extends Context.Reference<RelayFactsService>(
  "polaris/constellation/RelayFacts",
  {
    defaultValue: () => ({ packet: null }),
  }
) {}

const packetJson = Schema.encodeSync(Schema.fromJsonString(ConstellationOutboxPacket));

const workerCommand = ConstellationCommand.isAnyOf([
  "WorkerClaim",
  "WorkerAsk",
  "WorkerProgress",
  "WorkerPropose",
  "WorkerMessage",
]);

const queuedResult = (
  assignment: RemoteWorkerAssignment,
  existing: ConstellationRelayReceipt | null
) => {
  if (existing !== null && Predicate.isTagged(existing, "Applied"))
    return Effect.succeed(existing.result);

  if (existing !== null && Predicate.isTagged(existing, "Refused"))
    return Effect.fail(existing.rejection);

  return Effect.succeed(
    ConstellationResult.make({
      summary: "Queued for the Lead's Host.",
      next: "Continue your assignment; Polaris will relay this when the Desktop App reconnects.",
      revision: assignment.graph.revision,
      sequence: null,
    })
  );
};

const assignmentAttempt = (assignment: RemoteWorkerAssignment): Attempt => {
  const attempt = assignment.graph.attempts.find((a) => a.id === assignment.attemptId);

  if (attempt === undefined) throw new Error("An assignment has no matching Attempt");

  return attempt;
};

const findAssignment = (
  assignments: ReadonlyArray<RemoteWorkerAssignment>,
  binding: ConstellationBinding,
  command: ConstellationCommand
) => {
  if (binding.kind !== "session" || !workerCommand(command)) return null;

  return (
    assignments.find(
      (a) =>
        a.graph.id === command.constellationId &&
        a.attemptId === command.attemptId &&
        assignmentAttempt(a).sessionId === binding.sessionId
    ) ?? null
  );
};

export class ConstellationOutbox extends Context.Service<
  ConstellationOutbox,
  {
    readonly enqueue: (
      binding: ConstellationBinding,
      id: CommandId,
      command: ConstellationCommand
    ) => Effect.Effect<
      ConstellationResult,
      import("@polaris/protocol").ConstellationTransferError | ConstellationRejected
    >;
    readonly apply: (
      packet: ConstellationOutboxPacket
    ) => Effect.Effect<
      ConstellationRelayReceipt,
      import("@polaris/protocol").ConstellationTransferError
    >;
    readonly watch: Stream.Stream<
      ReadonlyArray<ConstellationOutboxPacket>,
      import("@polaris/protocol").ConstellationTransferError
    >;
  }
>()("polaris/constellation/Outbox") {
  static readonly layer = Layer.effect(
    ConstellationOutbox,
    Effect.gen(function* () {
      const storage = yield* TransferStorage;
      const store = yield* EventStore;
      const runtime = yield* ConstellationRuntime;
      const hostId = yield* ConstellationOwner;
      const worktrees = yield* ConstellationWorktrees;
      const workers = yield* RemoteWorkers;
      const serial = yield* Semaphore.make(1);

      return ConstellationOutbox.of({
        watch: SubscriptionRef.changes(storage.changes).pipe(
          Stream.mapEffect(() => storage.packets)
        ),
        enqueue: (binding, id, command) =>
          serial.withPermits(1)(
            Effect.gen(function* () {
              const assignment = findAssignment(yield* storage.assignments, binding, command);

              if (assignment === null || !workerCommand(command))
                return yield* transferError(
                  "E-AUTHORITY",
                  "This binding does not own a remote worker assignment"
                );
              const attempt = assignmentAttempt(assignment);
              const entryId = `${hostId}:${id}`;
              const previous = yield* storage.existing(entryId);

              if (previous !== null) {
                if (
                  JSON.stringify(previous.packet.entry.command) !== JSON.stringify(command) ||
                  previous.packet.entry.sessionId !== attempt.sessionId
                )
                  return yield* transferError(
                    "E-IDEMPOTENCY",
                    "The command ID already names another outbox request"
                  );

                return yield* queuedResult(assignment, previous.receipt);
              }

              if (attempt.state !== "working" && attempt.state !== "review")
                return yield* transferError("E-SETTLED", "The Attempt is no longer active");

              if (
                assignment.graph.attempts.findLast((a) => a.taskId === attempt.taskId)?.id !==
                attempt.id
              )
                return yield* transferError(
                  "E-SETTLED",
                  "Only the latest Attempt may queue worker commands"
                );

              const facts = Predicate.isTagged(command, "WorkerClaim")
                ? yield* collectClaimFacts(assignment, attempt, command, {
                    store,
                    storage,
                    worktrees,
                  })
                : { claimProbe: null, recordedChecks: [] };

              const entry = ConstellationOutboxEntry.make({
                id: entryId,
                constellationId: assignment.graph.id,
                ownerHostId: assignment.graph.hostId,
                workerHostId: hostId,
                sessionId: attempt.sessionId,
                attemptId: attempt.id,
                command,
              });

              yield* storage.enqueue(
                ConstellationOutboxPacket.make({
                  entry,
                  claimProbe: facts.claimProbe,
                  recordedChecks: facts.recordedChecks,
                })
              );

              if (Predicate.isTagged(command, "WorkerClaim")) yield* workers.claimed(attempt.id);

              return yield* queuedResult(assignment, null);
            })
          ),
        apply: (packet) =>
          serial.withPermits(1)(
            Effect.gen(function* () {
              const model = yield* store.model;
              const graph = model.constellations.get(packet.entry.constellationId)?.graph;
              const attempt = graph?.attempts.find((a) => a.id === packet.entry.attemptId);

              if (
                packet.entry.ownerHostId !== hostId ||
                graph?.hostId !== hostId ||
                attempt?.hostId !== packet.entry.workerHostId ||
                attempt.sessionId !== packet.entry.sessionId ||
                packet.entry.command.attemptId !== attempt.id ||
                packet.entry.command.constellationId !== graph.id
              )
                return yield* transferError(
                  "E-AUTHORITY",
                  "The outbox route does not match the owner's assignment"
                );
              const encoded = packetJson(packet);
              const cached = yield* storage.get("receipts", packet.entry.id);

              if (cached !== null) {
                const previous = decodeReceipt(cached);

                if (previous.packet !== encoded)
                  return yield* transferError(
                    "E-IDEMPOTENCY",
                    "The outbox ID already names a different owner request"
                  );

                return previous.receipt;
              }

              yield* storage.put("intents", `outbox:${packet.entry.id}`, encoded);

              const binding = { kind: "session" as const, sessionId: attempt.sessionId };
              const commandId = CommandId.make(packet.entry.id);

              const receipt = yield* store
                .commit({
                  commandId,
                  decide: (latest) => {
                    const record = latest.constellations.get(packet.entry.constellationId);

                    const decision = decideConstellation(record, packet.entry.command, {
                      binding,
                      hostId,
                      now: new Date().toISOString(),
                      attempts: [],
                      newLeadSessionId: null,
                      claimProbe: packet.claimProbe,
                      recordedChecks: packet.recordedChecks,
                      defaults: ConstellationSettings.make({}),
                      resourceHolders: [],
                      occupiedSessions: new Set(),
                      offlineSessionIds: new Set(),
                      commanded: true,
                    });

                    return decision.rejection === null
                      ? Effect.succeed(decision.events)
                      : Effect.fail(decision.rejection);
                  },
                })
                .pipe(
                  Effect.flatMap(
                    Effect.fnUntraced(function* (committed) {
                      if (Predicate.isTagged(committed, "Committed"))
                        yield* runtime.afterCommit(
                          binding,
                          packet.entry.command,
                          committed.envelopes
                        );

                      const record = (yield* store.model).constellations.get(
                        packet.entry.constellationId
                      );

                      if (record === undefined)
                        return yield* transferError(
                          "E-OWNER",
                          "The owning graph is unavailable",
                          true
                        );

                      return ConstellationRelayReceipt.cases.Applied.make({
                        id: packet.entry.id,
                        result: graphResult(record, committed.sequence, true),
                      });
                    })
                  ),
                  Effect.catchTag("ServiceError", (error) =>
                    Effect.fail(transferError("E-STORAGE", error.message, true))
                  ),
                  Effect.catchTag("ConstellationRejected", (rejection) =>
                    Effect.succeed(
                      ConstellationRelayReceipt.cases.Refused.make({
                        id: packet.entry.id,
                        rejection,
                      })
                    )
                  )
                );

              yield* storage.put(
                "receipts",
                packet.entry.id,
                encodeReceipt({ packet: encoded, receipt })
              );

              return receipt;
            })
          ),
      });
    })
  );
}

export { assignmentAttempt };
