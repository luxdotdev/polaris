import { Clock, Context, Effect, Layer } from "effect";
import { createHash } from "node:crypto";
import type {
  ConstellationId,
  ConstellationStats,
  DomainEvent,
  EventEnvelope,
  SessionId,
} from "@polaris/protocol";
import { EventStore } from "../../store/EventStore.ts";
import { UsageIndex } from "../../usage/index.ts";
import type { ConstellationBinding } from "../../engine/constellation.inputs.ts";
import { finding, refusal } from "../decision.ts";
import { canRead } from "../service.ts";
import { deriveStats, type StatsHistory } from "./derive.ts";
import { leadSpans } from "./attribution.ts";

const sessionTypes: ReadonlyArray<DomainEvent["_tag"]> = [
  "SessionCreated",
  "SessionStateChanged",
  "TurnStarted",
  "TurnEnded",
];

const leaseTypes: ReadonlyArray<DomainEvent["_tag"]> = [
  "ResourceLeaseQueued",
  "ResourceLeased",
  "ResourceReleased",
  "ResourceLeaseCanceled",
];

const make = Effect.gen(function* () {
  const store = yield* EventStore;
  const usage = yield* UsageIndex;

  const cache = new Map<
    ConstellationId,
    { history: StatsHistory; fingerprint: string | null; report: ConstellationStats | null }
  >();

  const get = Effect.fn("ConstellationStats.get")(
    function* (binding: ConstellationBinding, id: ConstellationId) {
      const model = yield* store.model;
      const record = model.constellations.get(id);

      if (record === undefined || !canRead(binding, record))
        return yield* refusal(record, [
          finding(
            record === undefined ? "E-NOT-FOUND" : "E-AUTHORITY",
            "The Constellation is unavailable to this caller",
            "Use its Lead, an active worker or the Desktop App."
          ),
        ]);
      let history = cache.get(id)?.history;

      if (
        history?.sequence !== model.sequence ||
        history.graph.revision !== record.graph.revision
      ) {
        const events = yield* store.readConstellationEvents({
          constellationId: id,
          after: 0,
          upTo: model.sequence,
        });

        const now = yield* Clock.currentTimeMillis;

        const sessionIds = new Set([
          ...leadSpans(record.graph, events, now).map((s) => s.sessionId),
          ...record.graph.attempts
            .filter((a) => a.hostId === record.graph.hostId)
            .map((a) => a.sessionId),
        ]);

        const sessions = new Map<SessionId, ReadonlyArray<EventEnvelope>>();

        yield* Effect.forEach(
          sessionIds,
          (sessionId) =>
            store
              .readEvents({ sessionId, after: 0, upTo: model.sequence, eventTypes: sessionTypes })
              .pipe(Effect.tap((events) => Effect.sync(() => sessions.set(sessionId, events)))),
          { concurrency: 4, discard: true }
        );

        const leases = yield* store.readEvents({
          sessionId: null,
          after: 0,
          upTo: model.sequence,
          eventTypes: leaseTypes,
        });

        history = { graph: record.graph, sequence: model.sequence, events, sessions, leases };
        cache.delete(id);
        cache.set(id, { history, fingerprint: null, report: null });

        if (cache.size > 32) {
          const oldest = cache.keys().next().value;

          if (oldest !== undefined) cache.delete(oldest);
        }
      }

      const asOf = yield* Clock.currentTimeMillis;

      const responses = yield* usage.responses({
        from: history.graph.createdAt,
        to: new Date(asOf).toISOString(),
        sessionIds: [...history.sessions.keys()],
      });

      const fingerprint = createHash("sha256")
        .update(JSON.stringify([responses.responses, responses.indexing]))
        .digest("hex");

      const previous = cache.get(id);

      const cached =
        previous?.fingerprint === fingerprint ? (previous.report ?? undefined) : undefined;

      const report = deriveStats(history, responses, asOf, cached);
      cache.delete(id);
      cache.set(id, { history, fingerprint, report });

      return report;
    },
    Effect.catchTag("ServiceError", (error) =>
      Effect.fail(
        refusal(undefined, [finding("E-STATS-READ", error.message, "Retry the Stats view.")])
      )
    )
  );

  return { get };
});

export class ConstellationStatsService extends Context.Service<
  ConstellationStatsService,
  Effect.Success<typeof make>
>()("polaris/daemon/constellation/Stats") {
  static readonly layer = Layer.effect(ConstellationStatsService, make);
}

export { deriveStats, type StatsHistory } from "./derive.ts";
