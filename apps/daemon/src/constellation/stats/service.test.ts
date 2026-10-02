import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { CommandId, DomainEvent, SessionId, UsageReport } from "@polaris/protocol";
import { Effect, Layer, Predicate, Stream } from "effect";
import { CID } from "../../engine/constellation.testing.ts";
import { EventStore } from "../../store/EventStore.ts";
import { UsageIndex } from "../../usage/index.ts";
import { ConstellationStatsService } from "./index.ts";
import { statsFixture } from "./stats.testing.ts";
import { seedStats } from "./store.testing.ts";

test("views reuse history, refresh Usage independently, enforce authority, and write no events or subscriptions", async () => {
  const home = mkdtempSync("/tmp/polaris-stats-service-");
  const fixture = statsFixture();
  let responses = fixture.responses;
  let graphReads = 0;
  let filteredReads = 0;
  let usageReads = 0;

  const observedStore = Layer.effect(
    EventStore,
    Effect.gen(function* () {
      const store = yield* EventStore;

      return EventStore.of({
        ...store,
        readConstellationEvents: (q) => {
          graphReads++;

          return store.readConstellationEvents(q);
        },
        readEvents: (q) => {
          filteredReads++;
          expect(q.eventTypes).toBeDefined();

          return store.readEvents(q);
        },
      });
    })
  ).pipe(Layer.provide(EventStore.layerSqlite(join(home, "state.sqlite"))));

  const usage = Layer.succeed(UsageIndex)(
    UsageIndex.of({
      refresh: () => Effect.void,
      query: () =>
        Effect.succeed(UsageReport.make({ buckets: [], indexedAt: null, indexing: false })),
      responses: () =>
        Effect.sync(() => {
          usageReads++;

          return responses;
        }),
      changes: Stream.empty,
      planLimits: Effect.succeed([]),
    })
  );

  const layer = ConstellationStatsService.layer.pipe(
    Layer.provideMerge(observedStore),
    Layer.provide(usage)
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const stats = yield* ConstellationStatsService;
        const store = yield* EventStore;
        expect(graphReads + filteredReads + usageReads).toBe(0);
        yield* seedStats;
        const before = (yield* store.model).sequence;
        const subscribers = yield* store.subscriberCount;
        const first = yield* stats.get({ kind: "user" }, CID);
        expect(graphReads).toBe(1);
        expect(filteredReads).toBe(4);
        const second = yield* stats.get({ kind: "user" }, CID);
        expect(second.usage).toEqual(first.usage);
        expect(graphReads).toBe(1);
        expect(filteredReads).toBe(4);
        responses = { ...responses, responses: responses.responses.slice(0, 1) };
        const updated = yield* stats.get({ kind: "user" }, CID);
        expect(updated.usage.total.tokens.input).toBe(100);
        expect(graphReads).toBe(1);

        const denied = yield* stats
          .get({ kind: "session", sessionId: SessionId.make("outsider") }, CID)
          .pipe(Effect.catchTag("ConstellationRejected", (e) => Effect.succeed(e)));

        expect(Predicate.isTagged(denied, "ConstellationRejected")).toBe(true);
        expect(usageReads).toBe(3);
        expect((yield* store.model).sequence).toBe(before);
        expect(yield* store.subscriberCount).toBe(subscribers);
        yield* store.commit({
          commandId: CommandId.make("stats-state"),
          decide: () =>
            Effect.succeed([
              DomainEvent.cases.ConstellationStateChanged.make({
                constellationId: CID,
                revision: 2,
                state: "paused",
              }),
            ]),
        });
        yield* stats.get({ kind: "user" }, CID);
        expect(graphReads).toBe(2);
        expect(filteredReads).toBe(8);
      }).pipe(Effect.provide(layer))
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("SQL event-type filtering preserves sequence cuts and empty selection reads nothing", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* seedStats;
      const store = yield* EventStore;
      const model = yield* store.model;

      const selected = yield* store.readEvents({
        sessionId: null,
        after: 0,
        upTo: model.sequence,
        eventTypes: ["ResourceLeaseQueued"],
      });

      expect(selected).toHaveLength(4);
      expect(selected.every((e) => Predicate.isTagged(e.event, "ResourceLeaseQueued"))).toBe(true);
      const boundary = selected[1]!;
      expect(
        yield* store.readEvents({
          sessionId: null,
          after: selected[0]!.sequence,
          upTo: boundary.sequence,
          eventTypes: ["ResourceLeaseQueued"],
        })
      ).toEqual([boundary]);
      expect(
        yield* store.readEvents({ sessionId: null, after: 0, upTo: model.sequence, eventTypes: [] })
      ).toEqual([]);
    }).pipe(Effect.provide(EventStore.layerSqlite(":memory:")))
  );
});
