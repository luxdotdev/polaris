import { ConstellationEvent, type ConstellationId } from "@polaris/protocol";
import { Effect, Match, Predicate } from "effect";
import type { Constellations } from "../service.ts";
import { graphResult } from "../service.ts";
import type { ConstellationBinding } from "../../engine/constellation.inputs.ts";
import { foldConstellation } from "../../store/constellation.ts";
import { finding, refusal } from "../decision.ts";
import { ConstellationOutbox, assignmentAttempt } from "./outbox.ts";
import { TransferStorage } from "./storage.ts";

/** H's role-bound adapter uses this facade for remote workers; local bindings retain the real service. */
export const withRemoteWorkerCommands = Effect.fnUntraced(function* (
  local: Constellations["Service"]
) {
  const storage = yield* TransferStorage;
  const outbox = yield* ConstellationOutbox;

  const mirror = Effect.fnUntraced(function* (binding: ConstellationBinding, id: ConstellationId) {
    if (binding.kind === "user") return null;

    return (
      (yield* storage.assignments.pipe(
        Effect.mapError((error) =>
          refusal(undefined, [finding(error.code, error.message, "Restore the worker outbox.")])
        )
      )).findLast(
        (a) => a.graph.id === id && assignmentAttempt(a).sessionId === binding.sessionId
      ) ?? null
    );
  });

  const recordOf = (assignment: import("@polaris/protocol").RemoteWorkerAssignment) =>
    foldConstellation(
      undefined,
      ConstellationEvent.cases.ConstellationStarted.make({
        constellationId: assignment.graph.id,
        revision: assignment.graph.revision,
        constellation: assignment.graph,
      }),
      assignment.graph.updatedAt
    )!;

  const mapError = (error: import("@polaris/protocol").ConstellationTransferError) =>
    refusal(undefined, [
      finding(error.code, error.message, "Reconnect the Desktop App to relay the worker outbox."),
    ]);

  // Reads and notes on a worker Host are not routed to the owning Host yet (ENG-1029).
  const noLogbook = refusal(undefined, [
    finding(
      "E-NOT-HERE",
      "The Logbook isn't available to workers on another Host yet",
      "Put the note in your Claim's decisions, or ask the Lead for what you need from the Logbook."
    ),
  ]);

  return {
    ...local,
    logbook: {
      ...local.logbook,
      read: Effect.fnUntraced(function* (binding, scope) {
        if ((yield* mirror(binding, scope.constellationId)) !== null) return yield* noLogbook;

        return yield* local.logbook.read(binding, scope);
      }),
    },
    command: Effect.fnUntraced(function* (binding, id, command) {
      const assignment = yield* mirror(binding, command.constellationId);

      if (assignment !== null && Predicate.isTagged(command, "Note")) return yield* noLogbook;

      return yield* assignment === null
        ? local.command(binding, id, command)
        : outbox
            .enqueue(binding, id, command)
            .pipe(
              Effect.catchTag("ConstellationTransferError", (error) => Effect.fail(mapError(error)))
            );
    }),
    status: Effect.fnUntraced(function* (binding, id, json, view) {
      const assignment = yield* mirror(binding, id);

      return assignment === null
        ? yield* local.status(binding, id, json, view)
        : graphResult(recordOf(assignment), null, json, undefined, undefined, undefined, view);
    }),
    resolve: Effect.fnUntraced(function* (binding, id, kind, name) {
      const assignment = yield* mirror(binding, id);

      if (assignment === null) return yield* local.resolve(binding, id, kind, name);
      const graph = assignment.graph;

      const ids: ReadonlyArray<string> = Match.value(kind).pipe(
        Match.when("attempt", () =>
          graph.attempts
            .filter(
              (a) =>
                a.id === name ||
                (a.taskId === name &&
                  graph.attempts.findLast((b) => a.taskId === b.taskId)?.id === a.id)
            )
            .map((a) => a.id)
        ),
        Match.when("session", () =>
          graph.attempts
            .filter((a) => a.sessionId === name || a.taskId === name)
            .map((a) => a.sessionId)
        ),
        Match.when("host", () =>
          graph.attempts.filter((a) => a.hostId === name).map((a) => a.hostId)
        ),
        Match.when("model", () => []),
        Match.exhaustive
      );

      const unique = [...new Set(ids)];

      if (unique.length !== 1)
        return yield* refusal(recordOf(assignment), [
          finding(
            "E-REFERENCE",
            "The friendly reference is unavailable or ambiguous",
            "Use its exact id from status."
          ),
        ]);

      return unique[0]!;
    }),
  } satisfies Constellations["Service"];
});
