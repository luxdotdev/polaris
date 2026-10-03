import { expect, test } from "bun:test";
import {
  Attempt,
  AttemptId,
  CommandId,
  Constellation,
  ConstellationId,
  DomainEvent,
} from "@polaris/protocol";
import { Effect, Fiber, Latch, Predicate, Stream, Struct, SubscriptionRef } from "effect";
import { CID } from "./constellation.testing.ts";
import { setup, wait, world } from "../constellation/delivery/testing.ts";
import { EventStore } from "../store/EventStore.ts";
import { registerStartupGraphs, withSessionBoundary, withSessionInput } from "./sessionBoundary.ts";

test("ordinary input commits without mounting a startup wait subscription", async () => {
  await world().run(
    Effect.gen(function* () {
      yield* setup();
      const store = yield* EventStore;
      const graph = (yield* store.model).constellations.get(CID)!.graph;
      const before = yield* store.subscriberCount;
      let released = false;

      const value = yield* withSessionInput(
        store,
        graph.leadSessionId,
        Effect.gen(function* () {
          expect(yield* store.subscriberCount).toBe(before);
          yield* Effect.acquireRelease(Effect.void, () =>
            Effect.sync(() => {
              released = true;
            })
          );

          return "delivered";
        })
      );

      expect(value).toBe("delivered");
      expect(released).toBe(true);
      expect(yield* store.subscriberCount).toBe(before);
    })
  );
});

test("a startup ending between the optimistic check and subscription cannot strand input", async () => {
  await world().run(
    Effect.gen(function* () {
      yield* setup();
      const store = yield* EventStore;
      const graph = (yield* store.model).constellations.get(CID)!.graph;
      const sid = graph.attempts[0]!.sessionId;
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
      let reads = 0;
      registerStartupGraphs(store, () =>
        Effect.sync(() => {
          reads++;

          return reads === 1 ? [graph] : [];
        })
      );
      let deliveries = 0;
      yield* withSessionInput(
        store,
        sid,
        Effect.sync(() => {
          deliveries++;
        })
      );
      expect(deliveries).toBe(1);
      expect(reads).toBe(3);
    })
  );
});

test("unassigned input rechecks a new startup after acquiring the Session boundary", async () => {
  await world().run(
    Effect.gen(function* () {
      yield* setup();
      const store = yield* EventStore;
      const graph = (yield* store.model).constellations.get(CID)!.graph;
      const sid = graph.leadSessionId;
      const before = yield* store.subscriberCount;
      const held = Latch.makeUnsafe(false);
      const release = Latch.makeUnsafe(false);

      const holder = yield* withSessionBoundary(
        store,
        sid,
        Effect.sync(() => held.openUnsafe()).pipe(Effect.andThen(release.await))
      ).pipe(Effect.forkChild);

      yield* held.await;

      let delivered = false;

      const input = yield* withSessionInput(
        store,
        sid,
        Effect.sync(() => {
          delivered = true;
        })
      ).pipe(Effect.forkChild);

      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* store.commit({
        commandId: null,
        decide: () =>
          Effect.succeed([
            DomainEvent.cases.AttemptStarted.make({
              constellationId: CID,
              revision: graph.revision + 1,
              attempt: Attempt.make(
                Struct.assign(graph.attempts[0]!, {
                  id: AttemptId.make("new-boundary-startup"),
                  sessionId: sid,
                })
              ),
            }),
          ]),
      });
      release.openUnsafe();
      yield* Fiber.join(holder);
      yield* wait(() => Effect.map(store.subscriberCount, (count) => count > before));
      expect(delivered).toBe(false);
      yield* store.commit({
        commandId: null,
        decide: () =>
          Effect.succeed([
            DomainEvent.cases.ConstellationStateChanged.make({
              constellationId: CID,
              revision: graph.revision + 2,
              state: "archived",
            }),
          ]),
      });
      yield* Fiber.join(input);
      expect(delivered).toBe(true);
    })
  );
});

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
          () => Effect.succeed(changes)
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

test("startup waiters wake only for their Session; graph wakes do not leak into Client Session feeds", async () => {
  await world().run(
    Effect.scoped(
      Effect.gen(function* () {
        yield* setup();
        const store = yield* EventStore;
        const graph = (yield* store.model).constellations.get(CID)!.graph;
        const sid = graph.attempts[0]!.sessionId;
        const checked = Latch.makeUnsafe(false);
        let reads = 0;
        registerStartupGraphs(store, () =>
          Effect.sync(() => {
            reads++;
            checked.openUnsafe();

            return [];
          })
        );
        const regular = yield* store.subscribe({ sessionId: sid });
        const seen: string[] = [];

        const listener = yield* regular.pipe(
          Stream.take(1),
          Stream.runForEach((item) =>
            Effect.sync(() => {
              if (Predicate.isTagged(item, "Event")) seen.push(item.envelope.event._tag);
            })
          ),
          Effect.forkChild
        );

        const input = yield* withSessionInput(store, sid, Effect.succeed("delivered")).pipe(
          Effect.forkChild
        );

        yield* checked.await;
        yield* Effect.yieldNow;
        const before = reads;
        yield* store.commit({
          commandId: null,
          decide: () =>
            Effect.succeed([
              DomainEvent.cases.SessionRenamed.make({
                sessionId: graph.leadSessionId,
                title: "Unrelated Session",
              }),
            ]),
        });
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        expect(reads).toBe(before);
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
        expect(yield* Fiber.join(input)).toBe("delivered");
        expect(seen).toEqual([]);
        yield* store.commit({
          commandId: null,
          decide: () =>
            Effect.succeed([
              DomainEvent.cases.SessionRenamed.make({ sessionId: sid, title: "Own Session" }),
            ]),
        });
        yield* Fiber.join(listener);
        expect(seen).toEqual(["SessionRenamed"]);
      })
    )
  );
});
