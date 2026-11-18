/**
 * Shares behind their first use (ENG-941). A Host with no Share store has never had a Share,
 * a mute or a Teammate's push registration: it answers from nothing, and the store, the
 * issuer polls and the statement verifier load with the first request that needs them.
 */
import { existsSync } from "node:fs";
import { ShareRpcs } from "@polaris/protocol";
import { Context, Effect, Layer } from "effect";
import type { RelayRoute } from "../linkedDevices/route.ts";
import type { HostSecrets } from "../secrets/index.ts";
import { ServiceError } from "../services.ts";
import type { TeammateConnections } from "../shares/connection.ts";
import { ShareNotifications, touchOfSession } from "../shares/notifications.ts";
import { presenceFeed, sharePresence } from "../shares/presence.ts";
import { NO_TARGETS, Shares, type SharesOptions } from "../shares/service.ts";
import type { ShareStore } from "../shares/store.ts";
import { cacheDaemonBuild, lazyRpcLayer } from "./lazy.ts";

interface Loaded {
  readonly shares: Shares["Service"];
  readonly store: ShareStore["Service"];
}

/**
 * `Shares` and `ShareNotifications` for the server: the real ones at once when `path` exists,
 * else stand-ins that load them on first use. Build `shares` before `notifications`.
 */
export const lazyShares = (options: {
  /** The Share store's file; it exists once anything was ever written to it. */
  readonly path: string;
  readonly shares: SharesOptions | undefined;
}) => {
  let loadShares: Effect.Effect<Loaded, ServiceError> = Effect.die("Shares are not built yet");
  let real: Shares["Service"] | null = null;

  const shares = Layer.fromBuildMemo((memoMap, scope) =>
    Effect.gen(function* () {
      const context = yield* Effect.context<HostSecrets | TeammateConnections>();
      const presence = sharePresence();
      const peerListeners = new Set<() => void>();
      let targets = NO_TARGETS;

      loadShares = yield* cacheDaemonBuild(
        Effect.gen(function* () {
          const [live, store] = yield* Effect.promise(() =>
            Promise.all([import("../shares/live.ts"), import("../shares/store.ts")])
          );

          const built = yield* Layer.buildWithMemoMap(
            live
              .sharesLayer(options.shares)
              .pipe(Layer.provideMerge(store.ShareStore.layer(options.path))),
            memoMap,
            scope
          ).pipe(
            Effect.provide(context),
            Effect.mapError(
              (error) => new ServiceError({ service: "transport", message: error.message })
            )
          );

          const loaded = Context.get(built, Shares);
          loaded.bindTargets(targets);
          loaded.guests.watch(() => peerListeners.forEach((listener) => listener()));
          real = loaded;

          return { shares: loaded, store: Context.get(built, store.ShareStore) };
        })
      );

      if (existsSync(options.path)) yield* loadShares;

      const use = <A, E>(run: (shares: Shares["Service"]) => Effect.Effect<A, E>) =>
        Effect.flatMap(Effect.orDie(loadShares), (loaded) => run(loaded.shares));

      return Context.make(
        Shares,
        Shares.of({
          create: (input, by) => use((loaded) => loaded.create(input, by)),
          renew: (id, expiresAt, by) => use((loaded) => loaded.renew(id, expiresAt, by)),
          revoke: (id, by) => use((loaded) => loaded.revoke(id, by)),
          list: (target) =>
            Effect.suspend(() => (real === null ? Effect.succeed([]) : real.list(target))),
          every: Effect.suspend(() => (real === null ? Effect.succeed([]) : real.every)),
          sharesOf: (device) => real?.sharesOf(device) ?? [],
          standing: (device) => use((loaded) => loaded.standing(device)),
          present: (device, statement) => use((loaded) => loaded.present(device, statement)),
          // No store, no Teammate: nobody is listed and no handshake is admitted.
          guests: {
            peers: () => real?.guests.peers() ?? [],
            admit: (source, noiseKey, payload) =>
              real?.guests.admit(source, noiseKey, payload) ?? null,
            serve: (session, guestId) => {
              if (real === null) session.end();
              else real.guests.serve(session, guestId);
            },
            ended: (session) => real?.guests.ended(session),
            watch: (listener) => {
              peerListeners.add(listener);

              return () => peerListeners.delete(listener);
            },
          },
          bindTargets: (bound) => {
            targets = bound;
            real?.bindTargets(bound);
          },
          targets: {
            session: (id) => Effect.suspend(() => targets.session(id)),
            hasConstellation: (id) => Effect.suspend(() => targets.hasConstellation(id)),
            turn: (sessionId, turnId) => Effect.suspend(() => targets.turn(sessionId, turnId)),
          },
          // Who is viewing is kept here from the start: the owner may be there before any Share.
          presence,
          watchPresence: (target) => presenceFeed(presence, target),
        })
      );
    })
  );

  const notifications = Layer.fromBuildMemo((memoMap, scope) =>
    Effect.gen(function* () {
      const context = yield* Effect.context<Shares | RelayRoute>();
      const targets = Context.get(context, Shares).targets;
      const listeners = new Set<() => void>();
      let loaded: ShareNotifications["Service"] | null = null;

      const load = yield* cacheDaemonBuild(
        Effect.gen(function* () {
          const { shares: realShares, store } = yield* loadShares;

          const [live, { ShareStore: Store }] = yield* Effect.promise(() =>
            Promise.all([import("../shares/notificationsLive.ts"), import("../shares/store.ts")])
          );

          const built = yield* Layer.buildWithMemoMap(
            live.shareNotificationsLayer,
            memoMap,
            scope
          ).pipe(
            Effect.provide(context),
            // The loaded Shares, not the stand-in: one store and one device table for both.
            Effect.provideService(Shares, realShares),
            Effect.provideService(Store, store)
          );

          const service = Context.get(built, ShareNotifications);
          service.watch(() => listeners.forEach((listener) => listener()));
          loaded = service;

          return service;
        })
      );

      if (real !== null) yield* load;

      const use = <A, E>(run: (service: ShareNotifications["Service"]) => Effect.Effect<A, E>) =>
        Effect.flatMap(Effect.orDie(load), run);

      return Context.make(
        ShareNotifications,
        ShareNotifications.of({
          register: (device, registration) => use((s) => s.register(device, registration)),
          unregister: (device) => use((s) => s.unregister(device)),
          setMuted: (person, target, muted) => use((s) => s.setMuted(person, target, muted)),
          touchOf: (sessionId) => touchOfSession(targets, sessionId),
          muted: (person, touch) => loaded?.muted(person, touch) ?? false,
          teammatesFor: (touch) => loaded?.teammatesFor(touch) ?? [],
          wake: (target, message) => use((s) => s.wake(target, message)),
          registered: () => loaded?.registered() ?? 0,
          watch: (listener) => {
            listeners.add(listener);

            return () => listeners.delete(listener);
          },
        })
      );
    })
  );

  return { shares, notifications };
};

/** The `shares.*` and `account.refreshStatement` handlers, loaded with the first of them. */
export const lazyShareHandlers = Layer.fromBuild((memoMap, scope) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<Shares | ShareNotifications>();

    const load = yield* cacheDaemonBuild(
      Effect.gen(function* () {
        const module = yield* Effect.promise(() => import("../shares/rpc.ts"));

        return yield* Layer.buildWithMemoMap(module.ShareRpcsLive, memoMap, scope).pipe(
          Effect.provide(context)
        );
      })
    );

    return yield* Layer.buildWithMemoMap(lazyRpcLayer(ShareRpcs, load), memoMap, scope);
  })
);
