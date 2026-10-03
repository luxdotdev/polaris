import { CommandId, type Constellation, type SessionId } from "@polaris/protocol";
import { Deferred, Effect, Predicate, Semaphore, Stream, SubscriptionRef } from "effect";
import type { EventStore } from "../store/EventStore.ts";

type Store = EventStore["Service"];

interface Lock {
  semaphore: Semaphore.Semaphore;
  users: number;
  queued: boolean;
}

interface Boundaries {
  readonly locks: Map<SessionId, Lock>;
  readonly inputs: Map<SessionId, Lock>;
  readonly startupWaiters: Map<SessionId, Deferred.Deferred<void>>;
  remote: (sessionId: SessionId) => Effect.Effect<ReadonlyArray<Constellation>>;
  remoteChanges:
    | ((sessionId: SessionId) => Effect.Effect<SubscriptionRef.SubscriptionRef<number>>)
    | null;
}

const stores = new WeakMap<Store, Boundaries>();

const boundaries = (store: Store) => {
  let value = stores.get(store);

  if (value === undefined) {
    value = {
      locks: new Map(),
      inputs: new Map(),
      startupWaiters: new Map(),
      remote: () => Effect.succeed([]),
      remoteChanges: null,
    };
    stores.set(store, value);
  }

  return value;
};

/** The worker Host supplies its durable assignment mirrors to the same input gate. */
export const registerStartupGraphs = (
  store: Store,
  remote: Boundaries["remote"],
  changes: Boundaries["remoteChanges"] = null
) => {
  const value = boundaries(store);
  value.remote = remote;
  value.remoteChanges = changes;
};

const serially = <A, E, R>(
  locks: Map<SessionId, Lock>,
  sessionId: SessionId,
  effect: Effect.Effect<A, E, R>
) =>
  Effect.suspend(() => {
    let lock = locks.get(sessionId);

    if (lock === undefined) {
      lock = { semaphore: Semaphore.makeUnsafe(1), users: 0, queued: false };
      locks.set(sessionId, lock);
    }

    const current = lock;
    current.users++;

    return current.semaphore.withPermit(effect).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          current.users--;

          if (current.users === 0) locks.delete(sessionId);
        })
      )
    );
  });

/** Startup holds this gate through readiness, retirement, commit and brief submission. */
export const withSessionBoundary = <A, E, R>(
  store: Store,
  sessionId: SessionId,
  effect: Effect.Effect<A, E, R>
) => serially(boundaries(store).locks, sessionId, effect);

/** A receipt-only startup commit wakes its Session's active input waiter. */
export const notifyStartupReceipt = Effect.fnUntraced(function* (
  store: Store,
  sessionId: SessionId
) {
  const waiter = boundaries(store).startupWaiters.get(sessionId);

  if (waiter !== undefined) yield* Deferred.succeed(waiter, undefined);
});

const startupReceiptChanges = (store: Store, sessionId: SessionId) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const waiter = Deferred.makeUnsafe<void>();
      boundaries(store).startupWaiters.set(sessionId, waiter);

      return waiter;
    }),
    () => Effect.sync(() => boundaries(store).startupWaiters.delete(sessionId))
  );

const pendingStartup = Effect.fnUntraced(function* (
  store: Store,
  sessionId: SessionId,
  graphs: ReadonlyArray<Constellation>
) {
  if (graphs.length === 0) return false;
  const model = yield* store.model;

  const session = model.sessions.get(sessionId)?.session;

  if (session?.state === "failed" || session?.state === "archived") return false;

  for (const graph of graphs) {
    if (graph.state === "completed" || graph.state === "archived") continue;
    const attempt = graph.attempts.findLast((a) => a.sessionId === sessionId);

    if (
      attempt?.state !== "working" ||
      graph.attempts.findLast((a) => a.taskId === attempt.taskId)?.id !== attempt.id ||
      model.constellations.get(graph.id)?.stale.has(attempt.id)
    )
      continue;

    if (
      session?.worktreeSetup?.status === "failed" &&
      session.worktreeSetup.id.startsWith(`${attempt.id}:setup:`)
    )
      continue;

    const started = yield* store
      .hasCommandReceipt(CommandId.make(`${attempt.id}:start`))
      .pipe(Effect.orDie);

    const failed = yield* store
      .hasCommandReceipt(CommandId.make(`${attempt.id}:startup-failed`))
      .pipe(Effect.orDie);

    if (!started && !failed) return true;
  }

  return false;
});

/** New input keeps FIFO order; Steer uses the running Turn directly in Dispatcher. */
export const withSessionInput = <A, E, R>(
  store: Store,
  sessionId: SessionId,
  effect: Effect.Effect<A, E, R>,
  ready?: Effect.Effect<boolean>
) =>
  Effect.suspend(() => {
    const joinedQueue = boundaries(store).inputs.get(sessionId)?.queued === true;

    return serially(
      boundaries(store).inputs,
      sessionId,
      Effect.gen(function* () {
        const graphs = Effect.gen(function* () {
          return (yield* store.startupGraphs(sessionId)).concat(
            yield* boundaries(store).remote(sessionId)
          );
        });

        let queuedForTurn =
          joinedQueue ||
          boundaries(store).inputs.get(sessionId)?.queued === true ||
          (yield* store.hasQueuedInput(sessionId));

        const tryCommit = Effect.gen(function* () {
          // Check before taking the startup lock, which may be held while an old Turn runs.
          const pending = yield* pendingStartup(store, sessionId, yield* graphs);
          queuedForTurn ||= pending;
          const queue = boundaries(store).inputs.get(sessionId);

          if (queue !== undefined) queue.queued ||= queuedForTurn;

          return pending
            ? null
            : yield* withSessionBoundary(
                store,
                sessionId,
                Effect.gen(function* () {
                  if (yield* pendingStartup(store, sessionId, yield* graphs)) {
                    queuedForTurn = true;

                    return null;
                  }

                  queuedForTurn ||= yield* store.hasQueuedInput(sessionId);

                  if (queuedForTurn && ready !== undefined && !(yield* ready)) return null;
                  const value = yield* effect;

                  if (queuedForTurn && ready !== undefined) yield* store.markQueuedInput(sessionId);

                  return { value };
                })
              );
        });

        // Ordinary input needs no subscription; subscribe and recheck only after a blocked attempt.
        const immediate = yield* Effect.scoped(tryCommit);

        if (immediate !== null) return immediate.value;

        while (true) {
          const result = yield* Effect.scoped(
            Effect.gen(function* () {
              const feed = yield* store.subscribe({
                sessionId,
                includeConstellation: true,
                filter: (item) => Predicate.isTagged(item, "Event"),
              });

              const receiptChanged = yield* startupReceiptChanges(store, sessionId);
              const remoteChanges = boundaries(store).remoteChanges;
              const changes = remoteChanges === null ? null : yield* remoteChanges(sessionId);

              const version = changes === null ? 0 : yield* SubscriptionRef.get(changes);

              const committed = yield* tryCommit;

              if (committed !== null) return committed;
              yield* Effect.raceFirst(
                Effect.raceFirst(
                  feed.pipe(Stream.take(1), Stream.runDrain),
                  Deferred.await(receiptChanged)
                ),
                changes === null
                  ? Effect.never
                  : SubscriptionRef.changes(changes).pipe(
                      Stream.filter((value) => value !== version),
                      Stream.take(1),
                      Stream.runDrain
                    )
              );

              return null;
            })
          );

          if (result !== null) return result.value;
        }
      })
    );
  });
