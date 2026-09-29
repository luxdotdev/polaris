/**
 * Every Host a Client talks to at once (Local, Mac Studio, a Linux VM, a Pi),
 * each with its own HostConnection and Connection State.
 */
import { Context, Effect, Exit, Layer, Option, Scope, SubscriptionRef } from "effect";
import {
  type HostConnection,
  type HostConnectionOptions,
  HostConnector,
} from "./HostConnection.ts";

export class HostRegistry extends Context.Service<
  HostRegistry,
  {
    /** Adds a Host (or replaces the one with the same key) and starts connecting. */
    readonly add: (options: HostConnectionOptions) => Effect.Effect<HostConnection>;
    /** Disconnects and forgets a Host. */
    readonly remove: (key: string) => Effect.Effect<void>;
    readonly get: (key: string) => Effect.Effect<Option.Option<HostConnection>>;
    /** All Hosts, updated as they are added and removed. */
    readonly hosts: SubscriptionRef.SubscriptionRef<ReadonlyMap<string, HostConnection>>;
  }
>()("polaris/client/HostRegistry") {
  static readonly layer = Layer.effect(
    HostRegistry,
    Effect.gen(function* () {
      const connector = yield* HostConnector;
      const parent = yield* Effect.scope;
      const scopes = new Map<string, Scope.Closeable>();
      const hosts = yield* SubscriptionRef.make<ReadonlyMap<string, HostConnection>>(new Map());

      const remove = (key: string) =>
        Effect.gen(function* () {
          const scope = scopes.get(key);

          if (scope === undefined) return;
          scopes.delete(key);
          yield* SubscriptionRef.update(hosts, (current) => {
            const next = new Map(current);
            next.delete(key);

            return next;
          });
          yield* Scope.close(scope, Exit.void);
        });

      const add = (options: HostConnectionOptions) =>
        Effect.gen(function* () {
          yield* remove(options.key);
          const scope = yield* Scope.fork(parent, "sequential");
          scopes.set(options.key, scope);
          const connection = yield* connector.connect(options).pipe(Scope.provide(scope));
          yield* SubscriptionRef.update(hosts, (current) =>
            new Map(current).set(options.key, connection)
          );

          return connection;
        });

      return HostRegistry.of({
        add,
        remove,
        get: (key) =>
          Effect.map(SubscriptionRef.get(hosts), (current) =>
            Option.fromNullishOr(current.get(key))
          ),
        hosts,
      });
    })
  );
}
