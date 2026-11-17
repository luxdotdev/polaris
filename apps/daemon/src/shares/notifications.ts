/**
 * Needs You for Teammates (ENG-941): a Teammate's device registers for push over its own
 * connection, and gets a Needs You about what a live Share that lists it covers with `approve`.
 * Each person, the owner included, may mute a shared target; the apps still show its Needs You.
 */
import {
  isShareLive,
  NotFound,
  type PushRegistrationError,
  type SessionId,
  shareCovers,
  ShareTarget,
  type ShareTouch,
} from "@polaris/protocol";
import type { PushMessage, PushRegistration, WakeOutcome } from "@polaris/protocol/relay";
import { Context, Effect, Layer } from "effect";
import { RelayRoute } from "../linkedDevices/route.ts";
import type { TeammateDevice } from "./connection.ts";
import { Shares } from "./service.ts";
import { ShareStore, type StoredMute, type StoredPush } from "./store.ts";

/** The person a mute belongs to: `owner` on the owner's own Clients and Linked Devices. */
export const OWNER = "owner";

/** A Teammate as a mute and presence name them: their issuer and that issuer's person ID. */
export const personOf = (device: Pick<TeammateDevice, "issuer" | "personId">) =>
  `${device.issuer} ${device.personId}`;

/** Whether `person` muted a target that covers `touch`. */
export const isMuted = (
  mutes: ReadonlyArray<StoredMute>,
  person: string,
  touch: ShareTouch
): boolean => mutes.some((mute) => mute.person === person && shareCovers(mute.target, touch));

const sameTarget = (a: ShareTarget, b: ShareTarget) =>
  ShareTarget.match(a, {
    Session: ({ sessionId }) => ShareTarget.guards.Session(b) && b.sessionId === sessionId,
    Constellation: ({ constellationId }) =>
      ShareTarget.guards.Constellation(b) && b.constellationId === constellationId,
  });

export class ShareNotifications extends Context.Service<
  ShareNotifications,
  {
    /** Stores the device's registration once its ticket signs this Host's relay address. */
    readonly register: (
      device: TeammateDevice,
      registration: PushRegistration
    ) => Effect.Effect<void, PushRegistrationError>;
    readonly unregister: (device: TeammateDevice) => Effect.Effect<void>;
    /** Mutes or unmutes `target` for `person`; NotFound when the Host has no such target. */
    readonly setMuted: (
      person: string,
      target: ShareTarget,
      muted: boolean
    ) => Effect.Effect<void, NotFound>;
    /** What a session touches, for `muted` and `teammatesFor`. */
    readonly touchOf: (sessionId: SessionId) => Effect.Effect<ShareTouch>;
    readonly muted: (person: string, touch: ShareTouch) => boolean;
    /** The Teammates' devices a Needs You about `touch` goes to, read when it is sent. */
    readonly teammatesFor: (touch: ShareTouch) => ReadonlyArray<StoredPush>;
    /** Seals and wakes; a token APNs no longer knows is forgotten. */
    readonly wake: (target: StoredPush, message: PushMessage) => Effect.Effect<WakeOutcome>;
    /** How many Teammate devices are registered; read synchronously. */
    readonly registered: () => number;
    /** Calls `listener` whenever the registrations change; returns the unsubscribe. */
    readonly watch: (listener: () => void) => () => void;
  }
>()("polaris/daemon/shares/ShareNotifications") {
  static readonly layer = Layer.effect(
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
                  push.noiseKey !== noiseKey ||
                  (token !== null && push.registration.token !== token)
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
        touchOf: (sessionId) =>
          Effect.map(
            shares.targets.session(sessionId),
            (found): ShareTouch => found?.touch ?? { sessionId, constellationId: null }
          ),
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
          Effect.tap(
            route.wakePeer(target.relayAddress, target.registration, message),
            (outcome) =>
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
}
