import { CommandId, type Constellation, type SessionId } from "@polaris/protocol";
import { Effect, Semaphore, Stream, SubscriptionRef } from "effect";
import type { EventStore } from "../store/EventStore.ts";

type Store = EventStore["Service"];

interface Boundaries {
  readonly locks: Map<SessionId, { semaphore: Semaphore.Semaphore; users: number }>;
  remote: () => Effect.Effect<ReadonlyArray<Constellation>>;
  remoteChanges: SubscriptionRef.SubscriptionRef<number> | null;
}

const stores = new WeakMap<Store, Boundaries>();

const boundaries = (store: Store) => {
  let value = stores.get(store);

  if (value === undefined) {
    value = { locks: new Map(), remote: () => Effect.succeed([]), remoteChanges: null };
    stores.set(store, value);
  }

  return value;
};

/** The worker Host supplies its durable assignment mirrors to the same input gate. */
export const registerStartupGraphs = (
  store: Store,
  remote: Boundaries["remote"],
  changes: SubscriptionRef.SubscriptionRef<number> | null = null
) => {
  const value = boundaries(store);
  value.remote = remote;
  value.remoteChanges = changes;
};

/** Startup holds this gate through readiness, retirement, commit and brief submission. */
export const withSessionBoundary = <A, E, R>(
  store: Store,
  sessionId: SessionId,
  effect: Effect.Effect<A, E, R>
) =>
  Effect.suspend(() => {
    const locks = boundaries(store).locks;
    let lock = locks.get(sessionId);

    if (lock === undefined) {
      lock = { semaphore: Semaphore.makeUnsafe(1), users: 0 };
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

const pendingStartup = Effect.fnUntraced(function* (store: Store, sessionId: SessionId) {
  const model = yield* store.model;

  if (model.sessions.get(sessionId)?.session.state === "failed") return false;

  const graphs = [...model.constellations.values()]
    .map((r) => r.graph)
    .concat(yield* boundaries(store).remote());

  for (const graph of graphs) {
    if (graph.state === "completed" || graph.state === "archived") continue;
    const attempt = graph.attempts.findLast((a) => a.sessionId === sessionId);

    if (
      attempt?.state !== "working" ||
      graph.attempts.findLast((a) => a.taskId === attempt.taskId)?.id !== attempt.id ||
      model.constellations.get(graph.id)?.stale.has(attempt.id)
    )
      continue;

    if (!(yield* store.hasCommandReceipt(CommandId.make(`${attempt.id}:start`)).pipe(Effect.orDie)))
      return true;
  }

  return false;
});

/** Committed startup has priority over Lead messages and user input on its Session. */
export const withSessionInput = <A, E, R>(
  store: Store,
  sessionId: SessionId,
  effect: Effect.Effect<A, E, R>,
  afterStartup?: Effect.Effect<boolean>
) =>
  Effect.gen(function* () {
    let queuedForStartup = afterStartup !== undefined && (yield* pendingStartup(store, sessionId));

    while (true) {
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const feed = yield* store.subscribe({});
          const changes = boundaries(store).remoteChanges;
          const version = changes === null ? null : yield* SubscriptionRef.get(changes);

          const committed = yield* withSessionBoundary(
            store,
            sessionId,
            Effect.gen(function* () {
              if (yield* pendingStartup(store, sessionId)) {
                queuedForStartup = true;

                return null;
              }

              if (queuedForStartup && afterStartup !== undefined && !(yield* afterStartup))
                return null;

              return { value: yield* effect };
            })
          );

          if (committed !== null) return committed;
          yield* Effect.raceFirst(
            feed.pipe(Stream.take(1), Stream.runDrain),
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
  });
