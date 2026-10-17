import { expect, test } from "bun:test";
import { TurnId } from "@polaris/protocol";
import { Effect, Exit, Layer } from "effect";
import { CID, draft } from "../../engine/constellation.testing.ts";
import { EventStore } from "../../store/EventStore.ts";
import { ConstellationSessionEffects } from "../delivery/inputs.ts";
import { setup, wait, world } from "../delivery/testing.ts";
import { startWorker } from "../startWorker.ts";
import { workingAttemptsLayer } from "../working.ts";
import { startPendingAttempt } from "./workers.ts";

// ENG-264: a worker holding its slot whose startup never sent the brief is started from its row.
test("starting a stalled worker sends its brief once, and refuses once it has started", async () => {
  let held = 0;

  const runtime = Layer.unwrap(
    Effect.gen(function* () {
      const store = yield* EventStore;

      const context = yield* Effect.context<
        EventStore | ConstellationSessionEffects | import("../setup/index.ts").WorktreeSetupService
      >();

      return workingAttemptsLayer({
        runtime: {
          prepare: () =>
            Effect.succeed({
              attempts: [draft()],
              newLeadSessionId: null,
              recordedChecks: [],
              claimProbe: null,
            }),
          resumeWorking: () => Effect.void,
          afterCommit: () => Effect.void,
        },
        acquireWorker: () =>
          Effect.acquireRelease(
            Effect.sync(() => {
              held++;
            }),
            () =>
              Effect.sync(() => {
                held--;
              })
          ),
        // The first startup takes its slot and never sends the brief.
        startWorker: () => Effect.never,
        resumeWorker: (attempt) =>
          Effect.gen(function* () {
            const graph = (yield* store.model).constellations.get(CID)!.graph;
            yield* startPendingAttempt(graph, attempt);
          }).pipe(Effect.provide(context)),
        failed: () => Effect.void,
      }).pipe(Layer.provide(Layer.succeed(EventStore)(store)));
    })
  );

  const w = world(":memory:", { runtime });
  await w.run(
    Effect.gen(function* () {
      yield* setup();
      yield* wait(() => Effect.succeed(held === 1));
      const store = yield* EventStore;
      const attempt = (yield* store.model).constellations.get(CID)!.graph.attempts[0]!;
      expect(w.turns).toHaveLength(0);

      const user = { kind: "user" } as const;
      expect((yield* startWorker(user, CID, attempt.id)).summary).toBe(
        `Starting ${attempt.taskId}`
      );
      yield* wait(() => Effect.succeed(w.turns.length === 1));
      expect(w.turns[0]!.id).toBe(TurnId.make(`${attempt.id}:start`));
      expect(held).toBe(1);

      const again = yield* Effect.exit(startWorker(user, CID, attempt.id));
      expect(Exit.isFailure(again)).toBe(true);
      expect(w.turns).toHaveLength(1);

      const lead = yield* Effect.exit(
        startWorker({ kind: "session", sessionId: attempt.sessionId }, CID, attempt.id)
      );

      expect(Exit.isFailure(lead)).toBe(true);
    })
  );
});
