/**
 * `ShareNotifications` on the Share store: Teammates' push registrations and everyone's mutes
 * (`notifications.ts` has the contract).
 */
import { isShareLive, NotFound, shareCovers, ShareTarget } from "@polaris/protocol";
import { Effect, Layer } from "effect";
import { RelayRoute } from "../linkedDevices/route.ts";
import { isMuted, personOf, ShareNotifications, touchOfSession } from "./notifications.ts";
import { Shares } from "./service.ts";
import { ShareStore, type StoredPush } from "./store.ts";

const sameTarget = (a: ShareTarget, b: ShareTarget) =>
  ShareTarget.match(a, {
    Session: ({ sessionId }) => ShareTarget.guards.Session(b) && b.sessionId === sessionId,
    Constellation: ({ constellationId }) =>
      ShareTarget.guards.Constellation(b) && b.constellationId === constellationId,
  });

export const shareNotificationsLayer = Layer.effect(
  ShareNotifications,
  Effect.gen(function* () {
    const store = yield* ShareStore;
    const shares = yield* Shares;
    const route = yield* RelayRoute;
    const listeners = new Set<() => void>();
    let pushes = yield* Effect.orDie(store.pushes);
    let mutes = yield* Effect.orDie(store.mutes);

    const changed = () => listeners.forEach((listener) => listener());

    const forget = (noiseKey: string, token: string | null) =>
      store.clearPush(noiseKey, token).pipe(
        Effect.orDie,
        Effect.andThen(
          Effect.sync(() => {
            pushes = pushes.filter(
              (push) =>
                push.noiseKey !== noiseKey || (token !== null && push.registration.token !== token)
            );
            changed();
          })
        )
      );

    const exists = (target: ShareTarget) =>
      ShareTarget.match(target, {
        Session: ({ sessionId }) =>
          Effect.map(shares.targets.session(sessionId), (found) => found !== null),
        Constellation: ({ constellationId }) => shares.targets.hasConstellation(constellationId),
      });

    return ShareNotifications.of({
      register: Effect.fn("ShareNotifications.register")(function* (device, registration) {
        yield* route.checkPush(device.relayAddress, registration);
        const push: StoredPush = { ...device, registration };
        yield* Effect.orDie(store.setPush(push));
        pushes = [...pushes.filter((p) => p.noiseKey !== device.noiseKey), push];
        changed();
      }),
      unregister: (device) => forget(device.noiseKey, null),
      setMuted: Effect.fn("ShareNotifications.setMuted")(function* (person, target, muted) {
        if (!(yield* exists(target)))
          return yield* new NotFound({ what: "shared target", id: JSON.stringify(target) });
        yield* Effect.orDie(store.setMuted({ person, target }, muted));
        const others = mutes.filter((m) => m.person !== person || !sameTarget(m.target, target));
        mutes = muted ? [...others, { person, target }] : others;
      }),
      touchOf: (sessionId) => touchOfSession(shares.targets, sessionId),
      muted: (person, touch) => isMuted(mutes, person, touch),
      teammatesFor: (touch) => {
        const now = Date.now();

        return pushes.filter((push) => {
          const approves = shares
            .sharesOf(push)
            .some(
              (share) =>
                isShareLive(share, now) &&
                shareCovers(share.target, touch) &&
                share.grant.includes("approve")
            );

          return approves && !isMuted(mutes, personOf(push), touch);
        });
      },
      wake: (target, message) =>
        Effect.tap(route.wakePeer(target.relayAddress, target.registration, message), (outcome) =>
          outcome === "unregistered"
            ? forget(target.noiseKey, target.registration.token)
            : Effect.void
        ),
      registered: () => pushes.length,
      watch: (listener) => {
        listeners.add(listener);

        return () => listeners.delete(listener);
      },
    });
  })
);
