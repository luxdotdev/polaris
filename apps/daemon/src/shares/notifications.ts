/**
 * Needs You for Teammates (ENG-941): a Teammate's device registers for push over its own
 * connection, and gets a Needs You about what a live Share that lists it covers with `approve`.
 * Each person, the owner included, may mute a shared target; the apps still show its Needs You.
 */
import {
  type NotFound,
  type PushRegistrationError,
  type SessionId,
  shareCovers,
  type ShareTarget,
  type ShareTouch,
} from "@polaris/protocol";
import type { PushMessage, PushRegistration, WakeOutcome } from "@polaris/protocol/relay";
import { Context, Effect } from "effect";
import type { TeammateDevice } from "./connection.ts";
import type { ShareTargets } from "./service.ts";
import type { StoredMute, StoredPush } from "./store.ts";

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

/** What a session touches; itself alone when the Host doesn't know it. */
export const touchOfSession = (targets: ShareTargets, sessionId: SessionId) =>
  Effect.map(
    targets.session(sessionId),
    (found): ShareTouch => found?.touch ?? { sessionId, constellationId: null }
  );

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
>()("polaris/daemon/shares/ShareNotifications") {}
