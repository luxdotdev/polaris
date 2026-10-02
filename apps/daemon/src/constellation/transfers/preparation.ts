import { Predicate, Effect } from "effect";
import type { ConstellationPreparation, ConstellationRuntimeService } from "../runtime.ts";
import { ConstellationOwner } from "../runtime.ts";
import { ConstellationWorktrees, transferError } from "../worktrees.ts";
import { finding, refusal } from "../decision.ts";
import { RelayFacts } from "./outbox.ts";
import { TransferStorage, decodeReceipt } from "./storage.ts";
import { ConstellationOutboxPacket } from "@polaris/protocol";
import { cleanupCommittedWorktrees } from "./cleanup.ts";
import { Schema } from "effect";

/** L supplies Session/Attempt allocation; W adds local git and authenticated relayed receipt observations. */
export const withWorktreePreparation = Effect.fnUntraced(function* (
  runtime: ConstellationRuntimeService
) {
  const worktrees = yield* ConstellationWorktrees;
  const storage = yield* TransferStorage;
  const hostId = yield* ConstellationOwner;

  const context = yield* Effect.context<
    import("../../store/EventStore.ts").EventStore | ConstellationWorktrees | TransferStorage
  >();

  return {
    ...runtime,
    afterCommit: (binding, command, envelopes) =>
      runtime.afterCommit(binding, command, envelopes).pipe(
        Effect.andThen(
          cleanupCommittedWorktrees(envelopes.map((e) => e.event)).pipe(
            Effect.provide(context),
            Effect.catchTag("ConstellationTransferError", (error) =>
              Effect.logWarning(error.message)
            )
          )
        )
      ),
    prepare: Effect.fnUntraced(function* (binding, command, model, commandId): Effect.fn.Return<
      ConstellationPreparation,
      import("@polaris/protocol").ConstellationRejected
    > {
      const prepared = yield* runtime.prepare(binding, command, model, commandId);
      const record = model.constellations.get(command.constellationId);

      if (record === undefined || !("attemptId" in command)) return prepared;
      const attempt = record.graph.attempts.find((a) => a.id === command.attemptId);

      if (attempt === undefined) return prepared;
      const relay = (yield* RelayFacts).packet;
      let probe = prepared.claimProbe;
      const checks = [...prepared.recordedChecks];

      const mapError = (e: import("@polaris/protocol").ConstellationTransferError) =>
        refusal(record, [
          finding(e.code, e.message, "Fetch the branch, check the working tree, and retry."),
        ]);

      if (Predicate.isTagged(command, "WorkerClaim")) {
        if (attempt.hostId === hostId)
          probe = yield* worktrees.probeClaim(attempt).pipe(Effect.mapError(mapError));
        else if (
          relay !== null &&
          relay.entry.id === commandId &&
          relay.entry.attemptId === attempt.id &&
          relay.entry.workerHostId === attempt.hostId &&
          relay.entry.sessionId === attempt.sessionId
        ) {
          probe = relay.claimProbe;
          checks.push(...relay.recordedChecks);
        } else
          return yield* refusal(record, [
            finding(
              "E-RELAY",
              "A remote Claim requires the worker Host's validated outbox",
              "Relay the durable worker request through the Desktop App."
            ),
          ]);
      }

      if (Predicate.isTagged(command, "Review") && Predicate.isTagged(command.action, "Accept")) {
        checks.push(
          ...(yield* acceptedChecks(
            record,
            attempt,
            model,
            command.action.mergedHead,
            worktrees,
            storage
          ).pipe(Effect.mapError(mapError)))
        );
      }

      return {
        ...prepared,
        claimProbe: probe,
        recordedChecks: checks,
      };
    }) satisfies ConstellationRuntimeService["prepare"],
  } satisfies ConstellationRuntimeService;
});

const acceptedChecks = Effect.fnUntraced(function* (
  record: import("../../store/constellation.ts").ConstellationRecord,
  attempt: import("@polaris/protocol").Attempt,
  model: import("../../store/model.ts").ReadModel,
  head: string,
  worktrees: ConstellationWorktrees["Service"],
  storage: TransferStorage["Service"]
) {
  const leadPath = model.sessions.get(record.graph.leadSessionId)?.session.cwd;

  if (leadPath === undefined)
    return yield* transferError("E-LEAD", "The Lead checkout is unavailable");
  yield* worktrees.verifyMerged(record.graph, attempt, leadPath, head);
  const checks: Array<import("../../engine/constellation.inputs.ts").RecordedCheck> = [];

  for (const stored of yield* storage.receipts) {
    const receipt = decodeReceipt(stored);

    const packet = Schema.decodeUnknownSync(Schema.fromJsonString(ConstellationOutboxPacket))(
      receipt.packet
    );

    if (packet.entry.attemptId === attempt.id && packet.entry.workerHostId === attempt.hostId)
      checks.push(...packet.recordedChecks);
  }

  return checks;
});
