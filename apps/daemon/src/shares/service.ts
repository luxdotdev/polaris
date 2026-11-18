/**
 * `Shares` as the rest of the Daemon reaches it (CONTEXT.md: Sharing; ADR 0112): the owner
 * creates, renews, revokes and lists Shares, and their devices are the Relay route's guests.
 * `live.ts` implements it; a Host that has never had a Share loads it on first use.
 */
import {
  Actor,
  type ConstellationId,
  type CreateShare,
  type NotFound,
  type SessionId,
  type Share,
  type ShareId,
  type ShareListing,
  type SharePresenceEntry,
  type ShareRefused,
  type ShareTarget,
  type ShareTouch,
  type StatementRejected,
  type Timestamp,
  type TurnId,
} from "@polaris/protocol";
import { Context, Effect, Layer, type Redacted, type Stream } from "effect";
import { RelayGuests } from "../linkedDevices/route.ts";
import type { TeammateDevice } from "./connection.ts";
import type { PollTiming } from "./devices.ts";
import type { SharePresence } from "./presence.ts";
import type { Fetch } from "./statement.ts";

/** What the Host knows of a Share's target: the Engine's sessions and Constellations. */
export interface ShareTargets {
  /** What a session touches, where it runs and whether it is a Worker's; null when unknown. */
  readonly session: (id: SessionId) => Effect.Effect<{
    readonly touch: ShareTouch;
    readonly cwd: string;
    readonly worker: boolean;
  } | null>;
  readonly hasConstellation: (id: ConstellationId) => Effect.Effect<boolean>;
  /** A Turn of that session, recent or old; null when the session has no such Turn. */
  readonly turn: (
    sessionId: SessionId,
    turnId: TurnId
  ) => Effect.Effect<{ readonly index: number; readonly working: boolean } | null>;
}

/** Before the Engine binds its own: the Host has no sessions, so nothing can be shared. */
export const NO_TARGETS: ShareTargets = {
  session: () => Effect.succeed(null),
  hasConstellation: () => Effect.succeed(false),
  turn: () => Effect.succeed(null),
};

export interface SharesOptions {
  /** For tests: the issuer's HTTP, the clock and the poll's timing. */
  readonly fetch?: Fetch | undefined;
  readonly now?: (() => number) | undefined;
  readonly timing?: Partial<PollTiming> | undefined;
  readonly skewMs?: number | undefined;
}

/** What a Teammate's connection stands on: its statement's expiry and its live Shares. */
export interface Standing {
  readonly expiresAt: Timestamp;
  readonly shares: ReadonlyArray<Share>;
}

/** The Teammate a Share's person acts as. */
export const teammateActor = (share: Share): Actor =>
  Actor.cases.Teammate.make({
    shareId: share.id,
    personId: share.person.id,
    name: share.person.name,
  });

export class Shares extends Context.Service<
  Shares,
  {
    readonly create: (
      input: typeof CreateShare.payloadSchema.Type,
      by: Actor
    ) => Effect.Effect<Share, NotFound | ShareRefused>;
    readonly renew: (
      id: ShareId,
      expiresAt: Timestamp | null,
      by: Actor
    ) => Effect.Effect<Share, NotFound | ShareRefused>;
    /** Ends the person's sessions before it answers; revoking twice is fine. */
    readonly revoke: (id: ShareId, by: Actor) => Effect.Effect<Share, NotFound>;
    /** Every Share with its log, newest first: all of them, or one target's. */
    readonly list: (target: ShareTarget | null) => Effect.Effect<ReadonlyArray<ShareListing>>;
    /** Every Share the Host has, ended ones included, as they stand now. */
    readonly every: Effect.Effect<ReadonlyArray<Share>>;
    /** The live Shares of the device's person at its issuer. */
    readonly sharesOf: (device: TeammateDevice) => ReadonlyArray<Share>;
    /** What the device's connection stands on now, without a new statement. */
    readonly standing: (device: TeammateDevice) => Effect.Effect<Standing, StatementRejected>;
    /** A newer statement, presented on the device's own connection. */
    readonly present: (
      device: TeammateDevice,
      statement: Redacted.Redacted<string>
    ) => Effect.Effect<Standing, StatementRejected>;
    /** Teammates' devices as the Relay route's peers. */
    readonly guests: RelayGuests["Service"];
    /** The Engine says what sessions and Constellations exist; until then none do. */
    readonly bindTargets: (targets: ShareTargets) => void;
    readonly targets: ShareTargets;
    readonly presence: SharePresence;
    /** Who has `target` open: the list now, then again on each change. */
    readonly watchPresence: (
      target: ShareTarget
    ) => Stream.Stream<ReadonlyArray<SharePresenceEntry>>;
  }
>()("polaris/daemon/shares/Shares") {
  /** The Relay route's guests are the Shares' devices. */
  static readonly guestsLayer = Layer.effect(
    RelayGuests,
    Effect.map(Shares, (shares) => shares.guests)
  );
}
