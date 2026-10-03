import { expect, test } from "bun:test";
import { Attempt, CommandId, Constellation, ConstellationId, DomainEvent } from "@polaris/protocol";
import { Effect, Fiber, Latch, Struct, SubscriptionRef } from "effect";
import { CID } from "./constellation.testing.ts";
import { setup, world } from "../constellation/delivery/testing.ts";
import { EventStore } from "../store/EventStore.ts";
import { registerStartupGraphs, withSessionInput } from "./sessionBoundary.ts";

for (const terminal of ["blocked", "lost"] as const)
  test(`a pending remote startup fences input and mirror ${terminal} wakes it without a local event`, async () => {
    await world().run(
      Effect.gen(function* () {
        yield* setup();
        const store = yield* EventStore;
        const graph = (yield* store.model).constellations.get(CID)!.graph;
        const attempt = graph.attempts[0]!;
        yield* store.commit({
          commandId: null,
          decide: () =>
            Effect.succeed([
              DomainEvent.cases.ConstellationStateChanged.make({
                constellationId: CID,
                revision: graph.revision + 1,
                state: "archived",
              }),
            ]),
        });

        let remote = Constellation.make(
          Struct.assign(graph, { id: ConstellationId.make("remote") })
        );

        const changes = yield* SubscriptionRef.make(0);
        const checked = Latch.makeUnsafe(false);
        registerStartupGraphs(
          store,
          () =>
            Effect.sync(() => {
              checked.openUnsafe();

              return [remote];
            }),
          changes
        );
        let delivered = false;

        const input = yield* withSessionInput(
          store,
          attempt.sessionId,
          Effect.sync(() => {
            delivered = true;
          })
        ).pipe(Effect.forkChild);

        yield* checked.await;
        yield* Effect.yieldNow;
        expect(delivered).toBe(false);
        const before = (yield* store.model).sequence;
        remote = Constellation.make(
          Struct.assign(remote, {
            attempts: [Attempt.make(Struct.assign(attempt, { state: terminal }))],
          })
        );
        yield* SubscriptionRef.update(changes, (n) => n + 1);
        yield* Fiber.join(input);
        expect(delivered).toBe(true);
        expect((yield* store.model).sequence).toBe(before);
        expect(yield* store.hasCommandReceipt(CommandId.make(`${attempt.id}:start`))).toBe(false);
      })
    );
  });
