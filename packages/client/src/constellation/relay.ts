import {
  ConstellationStreamItem,
  Sequence,
  type Constellation,
  type ConstellationId,
  type ConstellationOutboxPacket,
  type HostId,
  type RemotePlacementRequest,
  type RemoteDeliveryPacket,
} from "@polaris/protocol";
import {
  Context,
  Effect,
  Exit,
  Layer,
  Predicate,
  Queue,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import { openFeed, type SequenceMark } from "../resume.ts";
import { HostRegistry } from "../HostRegistry.ts";
import type { HostConnection, LiveSession } from "../HostConnection.ts";
import { connectionObservations } from "./connections.ts";
import {
  mirrorRemoteAssignments,
  prepareRemotePlacement,
  relayOutboxPacket,
  relayRemoteDelivery,
} from "./transfer.ts";

interface Pending<T> {
  readonly source: string;
  readonly value: T;
}

export class ConstellationRelay extends Context.Service<
  ConstellationRelay,
  {
    readonly retry: Effect.Effect<void>;
    readonly waiting: SubscriptionRef.SubscriptionRef<number>;
  }
>()("polaris/client/ConstellationRelay") {
  static readonly layer = Layer.effect(
    ConstellationRelay,
    Effect.gen(function* () {
      const registry = yield* HostRegistry;
      const parent = yield* Effect.scope;
      const wake = yield* Queue.sliding<void>(1);
      const waiting = yield* SubscriptionRef.make(0);
      const signal = Queue.offer(wake, undefined).pipe(Effect.asVoid);
      const connected = new Map<string, LiveSession>();
      const packets = new Map<string, Pending<ConstellationOutboxPacket>>();
      const placements = new Map<string, Pending<RemotePlacementRequest>>();
      const deliveries = new Map<string, Pending<RemoteDeliveryPacket>>();
      const graphs = new Map<ConstellationId, Constellation>();
      const hosts = new Map<string, { scope: Scope.Closeable; connection: HostConnection }>();
      const epochs = new Map<string, Scope.Closeable>();
      const observations = connectionObservations();

      const byId = (id: HostId) =>
        [...connected.values()].find((session) => session.host.hostId === id);

      const ignore = <A, E>(effect: Effect.Effect<A, E>) =>
        effect.pipe(
          Effect.catch(() => Effect.void),
          Effect.asVoid
        );

      const mirrorGraphs = Effect.gen(function* () {
        for (const graph of graphs.values()) {
          if (byId(graph.hostId) === undefined) continue;

          for (const worker of connected.values()) {
            if (
              worker.host.hostId !== graph.hostId &&
              graph.attempts.some((a) => a.hostId === worker.host.hostId)
            )
              yield* ignore(mirrorRemoteAssignments(graph, worker, byId(graph.hostId)));
          }
        }
      });

      const drain = Effect.gen(function* () {
        yield* observations.publish(graphs.values(), (id) => {
          const session = byId(id);

          return session === undefined
            ? undefined
            : { epoch: session.epoch, observe: session.client["constellation.connection"] };
        });

        for (const { source, value } of placements.values()) {
          const owner = connected.get(source);
          const worker = byId(value.worker.hostId);

          if (owner !== undefined && worker !== undefined)
            yield* ignore(prepareRemotePlacement(owner, worker, value));
        }

        for (const { source, value } of packets.values()) {
          const worker = connected.get(source);
          const owner = byId(value.entry.ownerHostId);

          if (worker !== undefined && owner !== undefined)
            yield* ignore(relayOutboxPacket(worker, owner, value));
        }

        yield* mirrorGraphs;

        for (const { source, value } of deliveries.values()) {
          const owner = connected.get(source);
          const worker = byId(value.workerHostId);

          if (owner !== undefined && worker !== undefined)
            yield* ignore(relayRemoteDelivery(owner, worker, value));
        }

        yield* SubscriptionRef.set(waiting, packets.size + placements.size + deliveries.size);
      });

      yield* Stream.fromQueue(wake).pipe(
        Stream.runForEach(() => drain),
        Effect.forkIn(parent)
      );

      const openEpoch = Effect.fnUntraced(function* (
        connection: HostConnection,
        session: LiveSession,
        scope: Scope.Scope
      ) {
        connected.set(connection.key, session);
        yield* signal;
        yield* session.client["constellation.outbox.watch"]({}).pipe(
          Stream.runForEach((values) =>
            Effect.gen(function* () {
              for (const [id, pending] of packets)
                if (pending.source === connection.key) packets.delete(id);

              for (const value of values)
                packets.set(value.entry.id, { source: connection.key, value });
              yield* signal;
            })
          ),
          Effect.catch(() => Effect.void),
          Effect.forkIn(scope)
        );
        yield* session.client["constellation.placements.watch"]({}).pipe(
          Stream.runForEach((values) =>
            Effect.gen(function* () {
              for (const [id, pending] of placements)
                if (pending.source === connection.key) placements.delete(id);

              for (const value of values)
                placements.set(value.id, { source: connection.key, value });
              yield* signal;
            })
          ),
          Effect.catch(() => Effect.void),
          Effect.forkIn(scope)
        );
        yield* session.client["constellation.delivery.watch"]({}).pipe(
          Stream.runForEach((values) =>
            Effect.gen(function* () {
              for (const [id, pending] of deliveries)
                if (pending.source === connection.key) deliveries.delete(id);

              for (const value of values)
                deliveries.set(value.id, { source: connection.key, value });
              yield* signal;
            })
          ),
          Effect.catch(() => Effect.void),
          Effect.forkIn(scope)
        );
        const observed = new Set<ConstellationId>();

        const watch = Effect.fnUntraced(function* (id: ConstellationId) {
          if (observed.has(id)) return;
          observed.add(id);

          const feed = yield* openFeed({
            source: {
              next: (minEpoch) =>
                minEpoch > 0 ? Effect.never : Effect.succeed({ epoch: 0, client: session.client }),
            },
            open: (client, afterSequence) =>
              client["constellation.subscribe"]({
                constellationId: id,
                afterSequence: afterSequence === null ? null : Sequence.make(afterSequence),
              }),
            mark: ConstellationStreamItem.match<SequenceMark>({
              Snapshot: (item) => ({ kind: "snapshot", sequence: item.sequence }),
              Event: (item) => ({ kind: "event", sequence: item.envelope.sequence }),
              Synchronized: (item) => ({ kind: "synchronized", sequence: item.sequence }),
              LivenessChanged: () => ({ kind: "ephemeral" }),
              BranchFetched: () => ({ kind: "ephemeral" }),
            }),
            isDisconnect: (error) => Predicate.isTagged(error, "RpcClientError"),
            gapless: false,
            maxCachedEvents: 256,
          }).pipe(Scope.provide(scope));

          yield* feed.stream.pipe(
            Stream.runForEach((item) =>
              Effect.gen(function* () {
                if (Predicate.isTagged(item, "Snapshot")) graphs.set(id, item.constellation);
                else if (Predicate.isTagged(item, "Event")) {
                  const result = yield* session.client["constellation.status"]({
                    constellationId: id,
                    json: true,
                  });

                  if (result.constellation !== null) graphs.set(id, result.constellation);
                } else return;
                yield* signal;
              })
            ),
            Effect.catch(() => Effect.void),
            Effect.forkIn(scope)
          );
        });

        yield* connection.subscribeHost.pipe(
          Stream.runForEach((item) =>
            Effect.gen(function* () {
              if (Predicate.isTagged(item, "Snapshot"))
                for (const summary of item.constellations ?? []) yield* watch(summary.id);

              if (
                Predicate.isTagged(item, "Event") &&
                Predicate.isTagged(item.envelope.event, "ConstellationStarted")
              )
                yield* watch(item.envelope.event.constellationId);
            })
          ),
          Effect.forkIn(scope)
        );
      });

      const track = Effect.fnUntraced(function* (connection: HostConnection, scope: Scope.Scope) {
        let epoch = -1;
        yield* connection.changes.pipe(
          Stream.runForEach((status) =>
            Effect.gen(function* () {
              observations.observe(status);

              if (status.state === "connected" && status.epoch === epoch) return;
              const previous = epochs.get(connection.key);

              if (previous !== undefined) yield* Scope.close(previous, Exit.void);
              epochs.delete(connection.key);
              connected.delete(connection.key);
              yield* signal;

              if (status.state !== "connected" || !status.capabilities.includes("constellation"))
                return;
              epoch = status.epoch;
              const next = yield* Scope.fork(scope);
              epochs.set(connection.key, next);
              const session = yield* connection.awaitSession;
              yield* openEpoch(connection, session, next);
            })
          ),
          Effect.forkIn(scope)
        );
      });

      yield* SubscriptionRef.changes(registry.hosts).pipe(
        Stream.runForEach((current) =>
          Effect.gen(function* () {
            for (const [key, tracked] of hosts) {
              if (current.get(key) === tracked.connection) continue;
              hosts.delete(key);
              epochs.delete(key);
              connected.delete(key);
              yield* Scope.close(tracked.scope, Exit.void);
            }

            for (const [key, connection] of current) {
              if (hosts.has(key)) continue;
              const scope = yield* Scope.fork(parent);
              hosts.set(key, { scope, connection });
              yield* track(connection, scope);
            }

            yield* signal;
          })
        ),
        Effect.forkIn(parent)
      );

      return ConstellationRelay.of({ retry: signal, waiting });
    })
  );
}
