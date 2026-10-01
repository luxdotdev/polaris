import { availableParallelism } from "node:os";
import {
  type CommandId,
  DomainEvent,
  HostResource,
  HostResourcesSnapshot,
  ResourceLease,
  ResourceError,
  type SessionId,
} from "@polaris/protocol";
import {
  Context,
  Deferred,
  Effect,
  Latch,
  Layer,
  Predicate,
  Semaphore,
  Stream,
  type Scope,
} from "effect";
import { paths } from "../paths.ts";
import { EventStore } from "../store/EventStore.ts";
import { loadHostInfo } from "../transport/hostInfo.ts";
import {
  DEFAULT_HOLD_LIMIT_MS,
  emptyResources,
  firstWaiter,
  holders,
  type LeaseWaiter,
  WORKERS_RESOURCE,
} from "./model.ts";
import { canGrantResource } from "./decide.ts";
import { processIdentity } from "./process.ts";

export interface AcquireLease {
  readonly requestId: string;
  readonly name: string;
  readonly processId: number;
  readonly processIdentity: string;
  readonly command: ReadonlyArray<string>;
  readonly sessionId: SessionId | null;
}

export class HostResources extends Context.Service<
  HostResources,
  {
    readonly get: Effect.Effect<HostResourcesSnapshot>;
    readonly declare: (
      commandId: CommandId,
      name: string,
      capacity: number,
      holdLimitMs?: number
    ) => Effect.Effect<HostResourcesSnapshot, ResourceError>;
    readonly remove: (
      commandId: CommandId,
      name: string
    ) => Effect.Effect<HostResourcesSnapshot, ResourceError>;
    readonly release: (
      commandId: CommandId | null,
      leaseId: string
    ) => Effect.Effect<HostResourcesSnapshot, ResourceError>;
    readonly setWorkerCap: (
      commandId: CommandId,
      cap: number | null
    ) => Effect.Effect<HostResourcesSnapshot, ResourceError>;
    readonly acquire: (request: AcquireLease) => Effect.Effect<ResourceLease, ResourceError>;
    readonly acquireWorker: (
      sessionId: SessionId
    ) => Effect.Effect<void, ResourceError, Scope.Scope>;
  }
>()("polaris/daemon/resources/HostResources") {
  static readonly layer = Layer.effect(
    HostResources,
    Effect.gen(function* () {
      const store = yield* EventStore;
      const { hostId } = yield* loadHostInfo(paths().root);
      let model = emptyResources();

      const refresh = Effect.gen(function* () {
        const current = (yield* store.model).hostResources ?? emptyResources();
        model = {
          resources: new Map(current.resources),
          leases: new Map(current.leases),
          waiting: new Map(current.waiting),
        };
      });

      yield* refresh;
      const lock = yield* Semaphore.make(1);
      const active = Latch.makeUnsafe(model.leases.size + model.waiting.size > 0);
      const pending = new Map<string, Deferred.Deferred<ResourceLease, ResourceError>>();
      const workers = new Set<SessionId>();
      const workerWaiters = new Map<SessionId, Deferred.Deferred<void, ResourceError>>();
      const warned = new Set<string>();
      const defaultCap = Math.max(1, Math.floor(availableParallelism() / 3));
      const workerCap = () => model.resources.get(WORKERS_RESOURCE)?.capacity ?? defaultCap;

      const serialized = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        lock.withPermits(1)(Effect.andThen(refresh, effect));

      const snapshot = () =>
        HostResourcesSnapshot.make({
          resources: [...model.resources.values()].filter((r) => r.name !== WORKERS_RESOURCE),
          resourceLeases: [...model.leases.values()],
          waiting: [...model.waiting.values()].map((w) => ({
            resource: w.resource,
            requestId: w.requestId,
          })),
          overdueLeaseIds: [...model.leases.values()].flatMap((lease) =>
            Date.now() - Date.parse(lease.acquiredAt) >=
            (model.resources.get(lease.resource)?.holdLimitMs ?? DEFAULT_HOLD_LIMIT_MS)
              ? [lease.id]
              : []
          ),
          workerCap: {
            cap: workerCap(),
            default: defaultCap,
            working: workers.size,
            waiting: workerWaiters.size,
          },
        });

      const write = Effect.fn("HostResources.write")(function* (
        commandId: CommandId | null,
        decided: ReadonlyArray<DomainEvent>
      ) {
        const result = yield* store
          .commit({
            commandId,
            decide: (current) =>
              Effect.succeed(
                decided.filter(
                  (event) =>
                    !Predicate.isTagged(event, "ResourceLeased") ||
                    canGrantResource(current.hostResources ?? emptyResources(), event.lease)
                )
              ),
          })
          .pipe(Effect.mapError((error) => new ResourceError({ message: error.message })));

        yield* refresh;

        if (model.leases.size + model.waiting.size > 0) active.openUnsafe();
        else active.closeUnsafe();

        return (
          !Predicate.isTagged(result, "Committed") || result.envelopes.length === decided.length
        );
      });

      const pumpWorkers = () => {
        for (const [sessionId, deferred] of workerWaiters) {
          if (workers.size >= workerCap()) break;
          workerWaiters.delete(sessionId);
          workers.add(sessionId);
          Deferred.doneUnsafe(deferred, Effect.void);
        }
      };

      const releaseEvent = (leaseId: string, resource: string, reason: string) =>
        model.waiting.has(leaseId)
          ? DomainEvent.cases.ResourceLeaseCanceled.make({
              hostId,
              requestId: leaseId,
              resource,
              reason,
            })
          : DomainEvent.cases.ResourceReleased.make({ hostId, leaseId, resource, reason });

      const grant = Effect.fn("HostResources.grant")(function* (waiter: LeaseWaiter) {
        if (waiter.processId === undefined || waiter.processIdentity === undefined) {
          yield* write(null, [
            releaseEvent(waiter.requestId, waiter.resource, "unrecoverable waiter"),
          ]);
          const deferred = pending.get(waiter.requestId);

          if (deferred !== undefined)
            Deferred.doneUnsafe(
              deferred,
              Effect.fail(new ResourceError({ message: "Unrecoverable waiter" }))
            );

          return true;
        }

        const identity = yield* Effect.promise(() => processIdentity(waiter.processId!));

        if (identity !== waiter.processIdentity) {
          yield* write(null, [releaseEvent(waiter.requestId, waiter.resource, "process exited")]);
          const deferred = pending.get(waiter.requestId);

          if (deferred !== undefined)
            Deferred.doneUnsafe(
              deferred,
              Effect.fail(new ResourceError({ message: "Process exited" }))
            );

          return true;
        }

        const lease = ResourceLease.make({
          id: waiter.requestId,
          hostId,
          resource: waiter.resource,
          sessionId: waiter.sessionId,
          attemptId: waiter.attemptId,
          command: waiter.command ?? [],
          processId: waiter.processId,
          processIdentity: identity,
          acquiredAt: new Date().toISOString(),
        });

        const granted = yield* write(null, [DomainEvent.cases.ResourceLeased.make({ lease })]);

        if (!granted) return false;
        const deferred = pending.get(lease.id);

        if (deferred !== undefined) Deferred.doneUnsafe(deferred, Effect.succeed(lease));

        return true;
      });

      const pump = Effect.fn("HostResources.pump")(function* () {
        for (const resource of model.resources.values()) {
          let waiter = firstWaiter(model, resource.name);

          while (
            waiter !== undefined &&
            holders(model, resource.name).length <
              (model.resources.get(resource.name)?.capacity ?? 0)
          ) {
            if (!(yield* grant(waiter))) break;
            waiter = firstWaiter(model, resource.name);
          }
        }
      });

      const release = Effect.fn("HostResources.release")(function* (
        commandId: CommandId | null,
        leaseId: string
      ) {
        const resource =
          model.leases.get(leaseId)?.resource ?? model.waiting.get(leaseId)?.resource;

        if (resource !== undefined) {
          warned.delete(leaseId);
          yield* write(commandId, [releaseEvent(leaseId, resource, "released")]);
          const deferred = pending.get(leaseId);

          if (deferred !== undefined)
            Deferred.doneUnsafe(
              deferred,
              Effect.fail(new ResourceError({ message: "Lease released" }))
            );
          yield* pump();
        }

        return snapshot();
      });

      const check = Effect.fn("HostResources.check")(function* () {
        for (const lease of model.leases.values()) {
          const identity = yield* Effect.promise(() => processIdentity(lease.processId));

          if (identity === null || identity !== lease.processIdentity) {
            warned.delete(lease.id);
            yield* write(null, [releaseEvent(lease.id, lease.resource, "process exited")]);
            continue;
          }

          if (snapshot().overdueLeaseIds.includes(lease.id) && !warned.has(lease.id)) {
            warned.add(lease.id);
            yield* Effect.logWarning(
              `Lease ${lease.resource} held past its limit; Release is available`,
              { leaseId: lease.id }
            );
          }
        }

        for (const waiter of model.waiting.values()) {
          const identity =
            waiter.processId === undefined
              ? null
              : yield* Effect.promise(() => processIdentity(waiter.processId!));

          if (identity === null || identity !== waiter.processIdentity) {
            yield* release(null, waiter.requestId);
          }
        }

        yield* pump();
      });

      const subscription = yield* store.subscribe({
        filter: (item) =>
          Predicate.isTagged(item, "Event") && item.envelope.event._tag.startsWith("Resource"),
      });

      yield* Stream.runForEach(subscription, () =>
        lock
          .withPermits(1)(
            Effect.gen(function* () {
              yield* refresh;
              pumpWorkers();
              yield* pump();

              if (model.leases.size + model.waiting.size > 0) active.openUnsafe();
              else active.closeUnsafe();
            })
          )
          .pipe(Effect.orDie)
      ).pipe(Effect.forkScoped);
      yield* serialized(check()).pipe(Effect.orDie);
      yield* Effect.gen(function* () {
        while (true) {
          yield* active.await;
          yield* Effect.sleep(1000);
          yield* serialized(check()).pipe(
            Effect.catch((error) => Effect.logWarning(error.message))
          );
        }
      }).pipe(Effect.forkScoped);

      const declare = Effect.fn("HostResources.declare")(function* (
        commandId: CommandId,
        name: string,
        capacity: number,
        holdLimitMs?: number
      ) {
        if (holders(model, name).length > capacity)
          return yield* new ResourceError({ message: "Release holders before reducing capacity" });

        const resource = HostResource.make({
          hostId,
          name,
          capacity,
          holdLimitMs: holdLimitMs ?? DEFAULT_HOLD_LIMIT_MS,
        });

        yield* write(commandId, [DomainEvent.cases.ResourceDeclared.make({ resource })]);
        pumpWorkers();
        yield* pump();

        return snapshot();
      });

      return HostResources.of({
        get: lock.withPermits(1)(Effect.andThen(refresh, Effect.sync(snapshot))),
        declare: (id, name, capacity, limit) =>
          name === WORKERS_RESOURCE
            ? Effect.fail(new ResourceError({ message: "Reserved resource name" }))
            : serialized(declare(id, name, capacity, limit)).pipe(Effect.uninterruptible),
        remove: (id, name) =>
          serialized(
            Effect.gen(function* () {
              if (
                name === WORKERS_RESOURCE ||
                holders(model, name).length > 0 ||
                firstWaiter(model, name) !== undefined
              )
                return yield* new ResourceError({
                  message: "Release holders and waiters before removing a resource",
                });
              yield* write(id, [
                DomainEvent.cases.ResourceRemoved.make({ hostId, resource: name }),
              ]);

              return snapshot();
            })
          ).pipe(Effect.uninterruptible),
        release: (id, leaseId) => serialized(release(id, leaseId)).pipe(Effect.uninterruptible),
        setWorkerCap: (id, cap) =>
          serialized(
            Effect.gen(function* () {
              if ((cap ?? defaultCap) < workers.size)
                return yield* new ResourceError({
                  message:
                    "Wait for working workers to release their slots before reducing the cap",
                });

              if (cap !== null) return yield* declare(id, WORKERS_RESOURCE, cap);
              yield* write(id, [
                DomainEvent.cases.ResourceRemoved.make({ hostId, resource: WORKERS_RESOURCE }),
              ]);
              pumpWorkers();

              return snapshot();
            })
          ).pipe(Effect.uninterruptible),
        acquire: (request) =>
          Effect.gen(function* () {
            const deferred = yield* Deferred.make<ResourceLease, ResourceError>();
            yield* serialized(
              Effect.gen(function* () {
                if (!model.resources.has(request.name) || request.name === WORKERS_RESOURCE)
                  return yield* new ResourceError({
                    message: `Unknown resource ${request.name}; declare it on this Host first`,
                  });
                const held = model.leases.get(request.requestId);

                if (held !== undefined) {
                  if (
                    held.processId !== request.processId ||
                    held.processIdentity !== request.processIdentity ||
                    held.resource !== request.name
                  )
                    return yield* new ResourceError({
                      message: "Lease request belongs to another process",
                    });
                  Deferred.doneUnsafe(deferred, Effect.succeed(held));

                  return;
                }

                const queued = model.waiting.get(request.requestId);

                if (queued !== undefined) {
                  if (
                    queued.processId !== request.processId ||
                    queued.processIdentity !== request.processIdentity ||
                    queued.resource !== request.name
                  )
                    return yield* new ResourceError({
                      message: "Lease request belongs to another process",
                    });
                  pending.set(request.requestId, deferred);
                  yield* pump();

                  return;
                }

                pending.set(request.requestId, deferred);
                yield* write(null, [
                  DomainEvent.cases.ResourceLeaseQueued.make({
                    hostId,
                    resource: request.name,
                    requestId: request.requestId,
                    sessionId: request.sessionId,
                    processId: request.processId,
                    processIdentity: request.processIdentity,
                    command: request.command,
                  }),
                ]);
                yield* pump();
              })
            ).pipe(Effect.uninterruptible);

            return yield* Deferred.await(deferred);
          }).pipe(Effect.ensuring(Effect.sync(() => pending.delete(request.requestId)))),
        acquireWorker: (sessionId) =>
          Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              const deferred = yield* Deferred.make<void, ResourceError>();
              yield* lock.withPermits(1)(
                Effect.gen(function* () {
                  if (workers.has(sessionId) || workerWaiters.has(sessionId))
                    return yield* new ResourceError({
                      message: "Worker already holds or awaits a slot",
                    });
                  workerWaiters.set(sessionId, deferred);
                  pumpWorkers();
                })
              );
              yield* Effect.addFinalizer(() =>
                lock.withPermits(1)(
                  Effect.sync(() => {
                    if (workerWaiters.get(sessionId) === deferred) workerWaiters.delete(sessionId);
                    else workers.delete(sessionId);
                    pumpWorkers();
                  })
                )
              );
              yield* restore(Deferred.await(deferred));
            })
          ),
      });
    })
  );
}
