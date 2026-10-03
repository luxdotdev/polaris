import {
  Attempt,
  AttemptCause,
  DomainEvent,
  SessionId,
  type ConstellationCommand,
} from "@polaris/protocol";
import { Effect, Layer, Predicate } from "effect";
import { A, draft, report } from "../engine/constellation.testing.ts";
import { EventStore } from "../store/EventStore.ts";
import { ConstellationRuntime } from "../constellation/runtime.ts";
import { session, world } from "../constellation/delivery/testing.ts";
import { startAttempt } from "../constellation/composition/workers.ts";
import { ConstellationSessionEffects } from "../constellation/delivery/inputs.ts";
import { WorktreeSetupService } from "../constellation/setup/index.ts";
import { attemptData } from "../constellation/data.ts";

/** Real journal and Turn delivery; provisioning and Git probes use deterministic fake facts. */
export const sendbackWorld = (file: string, deliver: boolean) => {
  const runtime = Layer.effect(
    ConstellationRuntime,
    Effect.gen(function* () {
      const store = yield* EventStore;

      const context = yield* Effect.context<
        EventStore | ConstellationSessionEffects | WorktreeSetupService
      >();

      return {
        prepare: Effect.fnUntraced(function* (_binding, command: ConstellationCommand, model, id) {
          const graph = model.constellations.get(command.constellationId)?.graph;
          const previous = graph?.attempts.at(-1);

          const retry =
            Predicate.isTagged(command, "Review") && Predicate.isTagged(command.action, "SendBack");

          const worker = retry ? command.action.worker : null;

          const sessionId =
            worker !== null && Predicate.isTagged(worker, "Existing")
              ? worker.sessionId
              : draft(A, `${id}:attempt`).sessionId;

          if (retry && worker !== null && Predicate.isTagged(worker, "New")) {
            const fresh = SessionId.make(`${id}:fresh`);
            const attempt = draft(A, `${id}:attempt`, fresh);
            yield* store
              .commit({
                commandId: null,
                decide: () =>
                  Effect.succeed([
                    DomainEvent.cases.SessionCreated.make({ session: session(attempt.sessionId) }),
                  ]),
              })
              .pipe(Effect.orDie);

            return {
              attempts: [
                new Attempt({
                  ...attemptData(attempt),
                  cause: AttemptCause.cases.Followup.make({ ref: previous!.id }),
                  base: "new-base",
                }),
              ],
              newLeadSessionId: null,
              claimProbe: null,
              recordedChecks: [],
            };
          }

          return {
            attempts: retry
              ? [
                  draft(
                    A,
                    `${id}:attempt`,
                    sessionId,
                    AttemptCause.cases.Followup.make({ ref: previous!.id })
                  ),
                ]
              : [draft()],
            newLeadSessionId: null,
            claimProbe: { dirtyPaths: [], branch: report().branch, head: report().head },
            recordedChecks: [],
          };
        }),
        resumeWorking: () => Effect.void,
        afterCommit: Effect.fnUntraced(function* (_binding, _command, envelopes) {
          if (!deliver) return;

          for (const { event } of envelopes) {
            if (!Predicate.isTagged(event, "AttemptStarted")) continue;

            const graph = (yield* store.model).constellations.get(event.constellationId)!.graph;
            yield* startAttempt(graph, event.attempt).pipe(Effect.provide(context), Effect.orDie);
          }
        }),
      } satisfies import("../constellation/runtime.ts").ConstellationRuntimeService;
    })
  );

  return world(file, { runtime });
};
