/**
 * Shares on this Host (CONTEXT.md: Sharing; ADR 0112): the owner creates, renews, revokes and
 * lists them; while one is live its person's devices are relay peers, admitted by a statement
 * from the Share's pinned issuer. Revoking ends the person's sessions at once; an expiry or a
 * lapsed statement ends them when it comes. With no live Share nothing runs: no poll, no timer.
 */
import {
  Actor,
  type ConstellationId,
  type CreateShare,
  isShareLive,
  NotFound,
  type SessionId,
  Share,
  SHARE_ROLE_GRANTS,
  shareCovers,
  shareExpiry,
  ShareId,
  ShareListing,
  ShareLogEntry,
  SharePerson,
  type SharePresenceEntry,
  ShareRefused,
  ShareTarget,
  type ShareTouch,
  StatementRejected,
  type Timestamp,
  type TurnId,
} from "@polaris/protocol";
import { Context, Effect, Layer, Option, Predicate, Queue, Redacted, Stream } from "effect";
import { RelayGuests } from "../linkedDevices/route.ts";
import type { DeviceSession } from "../linkedDevices/session.ts";
import { HostSecrets } from "../secrets/index.ts";
import { TeammateConnections, type TeammateDevice } from "./connection.ts";
import { deviceTable, POLL_TIMING, type PollTiming } from "./devices.ts";
import { DevicesAnswer, fetchDevices, revokeCapability } from "./issuer.ts";
import { sharePresence, type SharePresence } from "./presence.ts";
import { type Fetch, isIssuerUrl, statementVerifier, type VerifiedStatement } from "./statement.ts";
import { type ShareStoreError, ShareStore, type StoredShare } from "./store.ts";

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
const NO_TARGETS: ShareTargets = {
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

/** Timers longer than this fire at once in Bun and Node; a longer wait is taken in steps. */
const MAX_TIMER_MS = 2 ** 31 - 1;

const refused = (reason: ShareRefused["reason"]) => new ShareRefused({ reason });

const rejected = (reason: StatementRejected["reason"]) => new StatementRejected({ reason });

const sameTarget = (a: ShareTarget, b: ShareTarget) =>
  ShareTarget.match(a, {
    Session: ({ sessionId }) => Predicate.isTagged(b, "Session") && b.sessionId === sessionId,
    Constellation: ({ constellationId }) =>
      Predicate.isTagged(b, "Constellation") && b.constellationId === constellationId,
  });

/** The Teammate a Share's person acts as. */
export const teammateActor = (share: Share): Actor =>
  Actor.cases.Teammate.make({
    shareId: share.id,
    personId: share.person.id,
    name: share.person.name,
  });

const withShare = (share: Share, change: Partial<typeof Share.Type>) =>
  new Share({
    id: share.id,
    target: share.target,
    issuer: share.issuer,
    person: share.person,
    role: share.role,
    grant: share.grant,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    revokedAt: share.revokedAt,
    ...change,
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
  static layer(options: SharesOptions = {}) {
    return Layer.effect(Shares, makeShares(options));
  }

  /** The Relay route's guests are the Shares' devices. */
  static readonly guestsLayer = Layer.effect(
    RelayGuests,
    Effect.map(Shares, (shares) => shares.guests)
  );
}

const makeShares = Effect.fn("makeShares")(function* (options: SharesOptions) {
  const store = yield* ShareStore;
  const secrets = yield* HostSecrets;
  const connections = yield* TeammateConnections;
  const context = yield* Effect.context<never>();
  const runFork = Effect.runForkWith(context);
  const now = options.now ?? Date.now;
  const request = options.fetch ?? fetch;
  const verifier = statementVerifier({ fetch: options.fetch, now, skewMs: options.skewMs });
  const stamp = () => new Date(now()).toISOString();

  const shares = new Map<ShareId, StoredShare>(
    (yield* Effect.orDie(store.all)).map((stored) => [stored.share.id, stored])
  );

  const capabilities = new Map<ShareId, string>();

  /** Each open session with the Shares that listed its device when last checked. */
  const sessions = new Map<
    DeviceSession,
    { device: TeammateDevice; shares: ReadonlySet<ShareId> }
  >();

  const peerListeners = new Set<() => void>();
  const presence = sharePresence();
  let targets = NO_TARGETS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let listed = "";

  const log = (message: string) => runFork(Effect.logWarning(`shares: ${message}`));

  const persist = (write: Effect.Effect<unknown, ShareStoreError>) =>
    runFork(
      Effect.catch(write, (error) => Effect.logError(`shares: ${error.message}`)).pipe(
        Effect.asVoid
      )
    );

  const capabilityKey = (id: ShareId) => `shares/${id}/capability`;

  const capabilityOf = (id: ShareId) =>
    Effect.runPromise(
      Effect.suspend(() => {
        const held = capabilities.get(id);

        if (held !== undefined) return Effect.succeed<string | null>(held);

        return secrets.get(capabilityKey(id)).pipe(
          Effect.map((found) => Option.getOrNull(Option.map(found, Redacted.value))),
          Effect.tap((found) =>
            Effect.sync(() => {
              if (found !== null) capabilities.set(id, found);
            })
          ),
          Effect.catch(() => Effect.succeed(null))
        );
      })
    );

  const live = () => [...shares.values()].filter(({ share }) => isShareLive(share, now()));

  const ofPerson = (share: Share) => (device: TeammateDevice) =>
    device.issuer === share.issuer && device.personId === share.person.id;

  /** The person's live Shares that list this device: another device's Share is not its own. */
  const sharesOf = (device: TeammateDevice) => {
    const listing = new Set(table.sharesOf(device));

    return live()
      .map(({ share }) => share)
      .filter((share) => listing.has(share.id) && ofPerson(share)(device));
  };

  const listingOf = (device: TeammateDevice) => new Set(sharesOf(device).map((share) => share.id));

  const endSessions = (matches: (device: TeammateDevice) => boolean) => {
    for (const [session, { device }] of sessions) if (matches(device)) session.end();
  };

  /** The issuer's verified word names the person: the first is the Invite's acceptance. */
  const accepted = (id: ShareId, statement: VerifiedStatement) => {
    const stored = shares.get(id);

    if (stored === undefined) return;
    const { person } = stored.share;

    const unchanged =
      stored.accepted &&
      person.login === statement.login &&
      person.name === statement.name &&
      person.avatarUrl === statement.avatarUrl &&
      person.commitEmail === statement.commitEmail;

    if (unchanged) return;

    const share = withShare(stored.share, {
      person: new SharePerson({
        id: person.id,
        login: statement.login,
        name: statement.name,
        avatarUrl: statement.avatarUrl,
        commitEmail: statement.commitEmail,
      }),
    });

    const next = { ...stored, share, accepted: true };
    shares.set(id, next);
    persist(
      store.update(
        next,
        stored.accepted
          ? null
          : ShareLogEntry.cases.Accepted.make({
              shareId: id,
              at: stamp(),
              actor: teammateActor(share),
            })
      )
    );
  };

  const table = deviceTable({
    fetch: request,
    verifier,
    now,
    timing: { ...POLL_TIMING, ...options.timing },
    capabilityOf,
    onStatement: accepted,
    onChange: () => settle(),
    log,
  });

  const expire = () => {
    for (const stored of shares.values()) {
      const { share } = stored;
      const due = share.revokedAt === null && Date.parse(share.expiresAt) <= now();

      if (!due || stored.expiredLogged) continue;
      const next = { ...stored, expiredLogged: true };
      shares.set(share.id, next);
      persist(
        store.update(
          next,
          ShareLogEntry.cases.Expired.make({ shareId: share.id, at: stamp(), actor: null })
        )
      );
      endSessions(ofPerson(share));
    }
  };

  const arm = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;

    const next = Math.min(
      table.nextLapse() ?? Number.POSITIVE_INFINITY,
      ...live().map(({ share }) => Date.parse(share.expiresAt))
    );

    if (!Number.isFinite(next)) return;
    timer = setTimeout(
      () => {
        timer = null;
        settle();
      },
      Math.min(MAX_TIMER_MS, Math.max(1, next - now() + 1))
    );
  };

  /**
   * A session outlives neither its statement nor any Share that listed its device: losing one
   * ends it, so every request and feed it had open through that Share closes with it.
   */
  const endOutlived = () => {
    for (const [session, held] of sessions) {
      const listing = listingOf(held.device);
      const lost = [...held.shares].some((id) => !listing.has(id));

      if (lost || table.find(held.device.relayAddress, held.device.noiseKey) === null)
        session.end();
      else held.shares = listing;
    }
  };

  /** Brings polls, devices, sessions, peers and the one timer in step with the Shares and the clock. */
  function settle(): void {
    expire();
    table.sync(live());
    table.prune();
    endOutlived();
    const peers = table.peers().join(",");

    if (peers !== listed) {
      listed = peers;
      peerListeners.forEach((listener) => listener());
    }

    arm();
  }

  const admissible = (source: TeammateDevice["relayAddress"], noiseKey: string) => {
    const device = table.find(source, noiseKey);

    return device !== null && sharesOf(device).length > 0 ? device : null;
  };

  const serve = (session: DeviceSession, guestId: string) => {
    const device = admissible(session.peer, guestId);

    if (device === null) {
      session.end();

      return;
    }

    sessions.set(session, { device, shares: listingOf(device) });

    for (const shareId of table.sharesOf(device))
      persist(
        store.addDevice(
          shareId,
          device.noiseKey,
          ShareLogEntry.cases.DeviceAdded.make({
            shareId,
            at: stamp(),
            actor: null,
            deviceKey: device.noiseKey,
            deviceName: null,
          })
        )
      );
    runFork(connections.serve(session, device));
  };

  const standing = (device: TeammateDevice) =>
    Effect.suspend(() => {
      const mine = sharesOf(device);
      const expiresAt = table.expiryOf(device);

      if (mine.length === 0) return Effect.fail(rejected("no-share"));

      if (expiresAt === null) return Effect.fail(rejected("expired"));

      return Effect.succeed({ expiresAt: new Date(expiresAt).toISOString(), shares: mine });
    });

  const checkTarget = (target: ShareTarget): Effect.Effect<void, NotFound | ShareRefused> =>
    ShareTarget.match(target, {
      Session: ({ sessionId }) =>
        Effect.flatMap(
          targets.session(sessionId),
          (found): Effect.Effect<void, NotFound | ShareRefused> => {
            if (found === null)
              return Effect.fail(new NotFound({ what: "session", id: sessionId }));

            return found.worker ? Effect.fail(refused("worker")) : Effect.void;
          }
        ),
      Constellation: ({ constellationId }) =>
        Effect.flatMap(targets.hasConstellation(constellationId), (found) =>
          found
            ? Effect.void
            : Effect.fail(new NotFound({ what: "constellation", id: constellationId }))
        ),
    });

  const find = (id: ShareId) =>
    Effect.suspend(() => {
      const stored = shares.get(id);

      return stored === undefined
        ? Effect.fail(new NotFound({ what: "share", id }))
        : Effect.succeed(stored);
    });

  const write = (stored: StoredShare, entry: ShareLogEntry) =>
    Effect.orDie(store.update(stored, entry)).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          shares.set(stored.share.id, stored);
        })
      )
    );

  /** The issuer forgets the capability and so does the Host; neither failing undoes a revoke. */
  const forget = ({ share, inviteId }: StoredShare) =>
    Effect.gen(function* () {
      const capability = yield* Effect.promise(() => capabilityOf(share.id));
      capabilities.delete(share.id);
      yield* Effect.ignore(secrets.remove(capabilityKey(share.id)));

      if (capability !== null)
        yield* Effect.promise(() =>
          revokeCapability(request, { issuer: share.issuer, inviteId, capability })
        );
    });

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      if (timer !== null) clearTimeout(timer);
      table.stop();
    })
  );

  settle();

  return Shares.of({
    create: Effect.fn("Shares.create")(function* (input, by) {
      const expiresAt = shareExpiry(now(), input.expiresAt);

      if (expiresAt === null) return yield* refused("expiry");

      if (!isIssuerUrl(input.issuer)) return yield* refused("issuer-unreachable");
      yield* checkTarget(input.target);

      // Asking twice for one Invite answers the Share it already made.
      const existing = live().find(
        ({ share, inviteId }) => share.issuer === input.issuer && inviteId === input.inviteId
      );

      if (existing !== undefined) return existing.share;
      const capability = Redacted.value(input.hostCapability);

      const answer = yield* Effect.promise(() =>
        fetchDevices(request, {
          issuer: input.issuer,
          inviteId: input.inviteId,
          capability,
          etag: null,
          waitS: 0,
        })
      );

      const unknown = DevicesAnswer.match(answer, {
        Devices: () => null,
        Unchanged: () => null,
        Gone: () => refused("invite"),
        Unreachable: () => refused("issuer-unreachable"),
      });

      if (unknown !== null) return yield* unknown;

      const share = new Share({
        id: ShareId.make(`share_${crypto.randomUUID()}`),
        target: input.target,
        issuer: input.issuer,
        person: new SharePerson({
          id: input.personId,
          login: input.inviteeLogin,
          name: input.inviteeLogin,
          avatarUrl: null,
          commitEmail: null,
        }),
        role: input.role,
        grant: SHARE_ROLE_GRANTS[input.role],
        createdAt: stamp(),
        expiresAt,
        revokedAt: null,
      });

      const stored = { share, inviteId: input.inviteId, accepted: false, expiredLogged: false };

      yield* Effect.orDie(secrets.set(capabilityKey(share.id), input.hostCapability));
      capabilities.set(share.id, capability);
      yield* Effect.orDie(
        store.create(
          stored,
          ShareLogEntry.cases.Invited.make({
            shareId: share.id,
            at: share.createdAt,
            actor: by,
            role: share.role,
            expiresAt,
          })
        )
      );
      shares.set(share.id, stored);
      settle();

      return share;
    }, Effect.uninterruptible),
    renew: Effect.fn("Shares.renew")(function* (id, requested, by) {
      const stored = yield* find(id);

      if (stored.share.revokedAt !== null) return yield* refused("ended");
      const expiresAt = shareExpiry(now(), requested);

      if (expiresAt === null) return yield* refused("expiry");
      const share = withShare(stored.share, { expiresAt });

      yield* write(
        { ...stored, share, expiredLogged: false },
        ShareLogEntry.cases.Renewed.make({ shareId: id, at: stamp(), actor: by, expiresAt })
      );
      settle();

      return share;
    }, Effect.uninterruptible),
    revoke: Effect.fn("Shares.revoke")(function* (id, by) {
      const stored = yield* find(id);

      if (stored.share.revokedAt !== null) return stored.share;
      const share = withShare(stored.share, { revokedAt: stamp() });

      yield* write(
        { ...stored, share },
        ShareLogEntry.cases.Revoked.make({ shareId: id, at: stamp(), actor: by })
      );
      endSessions(ofPerson(share));
      settle();
      runFork(forget(stored));

      return share;
    }, Effect.uninterruptible),
    list: (target) =>
      Effect.forEach(
        [...shares.values()]
          .filter(({ share }) => target === null || sameTarget(share.target, target))
          .toReversed(),
        ({ share }) =>
          Effect.map(Effect.orDie(store.log(share.id)), (log) => new ShareListing({ share, log }))
      ),
    sharesOf,
    standing,
    present: (device, statement) =>
      Effect.gen(function* () {
        const verified = yield* verifier.verify(device.issuer, Redacted.value(statement));

        if (verified.noiseKey !== device.noiseKey) return yield* rejected("device");

        if (verified.personId !== device.personId) return yield* rejected("person");
        table.extend(device, verified.expiresAt);
        sharesOf(device).forEach((share) => accepted(share.id, verified));
        arm();

        return yield* standing(device);
      }),
    every: Effect.sync(() => [...shares.values()].map(({ share }) => share)),
    guests: {
      peers: table.peers,
      admit: (source, noiseKey) => (admissible(source, noiseKey) === null ? null : noiseKey),
      serve,
      ended: (session) => {
        sessions.delete(session);
      },
      watch: (listener) => {
        peerListeners.add(listener);

        return () => peerListeners.delete(listener);
      },
    },
    bindTargets: (bound) => {
      targets = bound;
    },
    targets: {
      session: (id) => Effect.suspend(() => targets.session(id)),
      hasConstellation: (id) => Effect.suspend(() => targets.hasConstellation(id)),
      turn: (sessionId, turnId) => Effect.suspend(() => targets.turn(sessionId, turnId)),
    },
    presence,
    // Sliding by one: a burst of changes reads the list once more, never once per change.
    watchPresence: (target) =>
      Stream.callback<void>(
        (queue) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              const unwatch = presence.watch(() => Queue.offerUnsafe(queue, undefined));

              Queue.offerUnsafe(queue, undefined);

              return unwatch;
            }),
            (unwatch) => Effect.sync(unwatch)
          ),
        { bufferSize: 1, strategy: "sliding" }
      ).pipe(Stream.map(() => presence.list((touch) => shareCovers(target, touch)))),
  });
});
