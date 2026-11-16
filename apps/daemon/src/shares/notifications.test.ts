/**
 * Needs You for Teammates (ENG-941) through the real Share service and store: which devices a
 * Needs You reaches, mutes, and forgetting a token APNs no longer knows. The relay is faked.
 */
import { afterEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import {
  Actor,
  ConstellationId,
  InviteId,
  PersonId,
  PushRegistrationError,
  SessionId,
  ShareTarget,
  type ShareTouch,
} from "@polaris/protocol";
import {
  type PushMessage,
  type PushRegistration,
  RelayAddress,
  type WakeOutcome,
} from "@polaris/protocol/relay";
import { Effect, Layer, Redacted, Schema } from "effect";
import { RelayRoute } from "../linkedDevices/route.ts";
import { tempDir } from "../platform/tempDir.testing.ts";
import { HostSecrets } from "../secrets/index.ts";
import { TeammateConnections, type TeammateDevice } from "./connection.ts";
import { type FakeDevice, type FakeIssuer, startFakeIssuer } from "./issuer.testing.ts";
import { OWNER, personOf, ShareNotifications } from "./notifications.ts";
import { Shares } from "./service.ts";
import { ShareStore } from "./store.ts";

const S1 = SessionId.make("s1");

const WORKER = SessionId.make("worker");

const C1 = ConstellationId.make("c1");

const CONTRIBUTOR = PersonId.make("p1");

const COMMENTER = PersonId.make("p2");

const servers: Array<FakeIssuer> = [];

afterEach(() => {
  servers.splice(0).forEach((server) => server.stop());
});

const address = () => Schema.decodeSync(RelayAddress)(randomBytes(16).toString("base64url"));

const device = (personId: PersonId): FakeDevice => ({
  personId,
  relayAddress: address(),
  noiseKey: randomBytes(32).toString("base64url"),
});

/** A registration the store accepts; `ticket.sig` "bad" is refused by the fake relay. */
const registration = (label: string, sig = "sig"): PushRegistration => ({
  token: Buffer.from(label.padEnd(32, "-")).toString("hex"),
  environment: "sandbox",
  pushKey: "A".repeat(87),
  ticket: { key: "key", sig },
});

const message: PushMessage = {
  v: 1,
  kind: "needs-you",
  hostId: "host-1",
  hostName: "studio",
  sessionId: S1,
  requestId: "r1",
  category: "approval",
  title: "Codex needs you",
  subtitle: "studio · Fix the build",
  body: "Run bun test",
  at: "2026-11-16T12:00:00.000Z",
};

/** What the fake relay answers each wake with; a test may change it. */
interface WakeAnswer {
  current: WakeOutcome;
}

/** The relay at the boundary: tickets starting `bad` are refused, `outcome` answers each wake. */
const relay = (woken: Array<RelayAddress>, outcome: WakeAnswer) => {
  const used: Pick<RelayRoute["Service"], "checkPush" | "wakePeer"> = {
    checkPush: (_, pushed) =>
      pushed.ticket.sig === "bad"
        ? Effect.fail(new PushRegistrationError({ reason: "failed", message: "bad ticket" }))
        : Effect.void,
    wakePeer: (peer) =>
      Effect.sync(() => {
        woken.push(peer);

        return outcome.current;
      }),
  };

  // SAFETY: ShareNotifications calls only `checkPush` and `wakePeer`.
  return used as RelayRoute["Service"];
};

const touchOf = (sessionId: SessionId): ShareTouch =>
  sessionId === WORKER ? { sessionId, constellationId: C1 } : { sessionId, constellationId: null };

/** A Host whose Shares live under `root`: S1 alone, and a Worker of Constellation c1. */
const onHost = <A, E>(
  root: string,
  server: FakeIssuer,
  program: Effect.Effect<A, E, Shares | ShareNotifications>,
  woken: Array<RelayAddress> = [],
  outcome: WakeAnswer = { current: "sent" }
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* program;
    }).pipe(
      Effect.provide(
        ShareNotifications.layer.pipe(
          Layer.provideMerge(
            Layer.effectDiscard(
              Effect.map(Shares, (shares) =>
                shares.bindTargets({
                  session: (id) =>
                    Effect.succeed(
                      id === S1 || id === WORKER
                        ? { touch: touchOf(id), cwd: "/repo", worker: id === WORKER }
                        : null
                    ),
                  hasConstellation: (id) => Effect.succeed(id === C1),
                  turn: () => Effect.succeed(null),
                })
              )
            ).pipe(
              Layer.provideMerge(
                Shares.layer({
                  fetch: server.fetch,
                  timing: { waitS: 2, pauseMs: 5, retryMs: 20 },
                  skewMs: 0,
                })
              )
            )
          ),
          Layer.provideMerge(
            Layer.mergeAll(
              ShareStore.layer(join(root, "shares.sqlite")),
              HostSecrets.memory(),
              Layer.succeed(TeammateConnections)({ serve: () => Effect.void }),
              Layer.succeed(RelayRoute)(relay(woken, outcome))
            )
          )
        )
      ),
      Effect.scoped
    )
  );

const share = (
  server: FakeIssuer,
  inviteId: InviteId,
  personId: PersonId,
  role: "contributor" | "commenter",
  target: ShareTarget = ShareTarget.cases.Session.make({ sessionId: S1 })
) =>
  Effect.flatMap(Shares, (shares) =>
    shares.create(
      {
        target,
        personId,
        inviteeLogin: personId,
        role,
        expiresAt: null,
        issuer: server.issuer,
        inviteId,
        hostCapability: Redacted.make(`cap-${inviteId}`),
      },
      Actor.cases.Client.make({})
    )
  );

/** The device as its connection names it, once the issuer has listed it on a live Share. */
const admitted = (server: FakeIssuer, listed: FakeDevice) =>
  Effect.gen(function* () {
    const shares = yield* Shares;

    const teammate: TeammateDevice = {
      issuer: server.issuer,
      personId: PersonId.make(listed.personId),
      noiseKey: listed.noiseKey,
      relayAddress: Schema.decodeSync(RelayAddress)(listed.relayAddress),
    };

    for (let i = 0; i < 300; i++) {
      if (shares.sharesOf(teammate).length > 0) return teammate;
      yield* Effect.sleep("5 millis");
    }

    return yield* Effect.die(new Error("the device was never listed"));
  });

const issuer = async (invites: ReadonlyArray<InviteId>) => {
  const server = await startFakeIssuer();
  servers.push(server);
  invites.forEach((inviteId) => server.invite(inviteId, `cap-${inviteId}`));

  return server;
};

const addresses = (targets: ReadonlyArray<{ readonly relayAddress: RelayAddress }>) =>
  targets.map((target) => target.relayAddress);

test("a Needs You reaches a Contributor's devices its Share lists, never a Commenter's", async () => {
  const contributing = InviteId.make("inv_c");
  const commenting = InviteId.make("inv_m");
  const server = await issuer([contributing, commenting]);
  const phone = device(CONTRIBUTOR);
  const tablet = device(COMMENTER);

  await onHost(
    tempDir("pl-shares-"),
    server,
    Effect.gen(function* () {
      const notifications = yield* ShareNotifications;
      yield* share(server, contributing, CONTRIBUTOR, "contributor");
      yield* share(server, commenting, COMMENTER, "commenter");
      server.list(contributing, [phone]);
      server.list(commenting, [tablet]);
      const contributor = yield* admitted(server, phone);
      const commenter = yield* admitted(server, tablet);

      yield* notifications.register(contributor, registration("t-phone"));
      yield* notifications.register(commenter, registration("t-tablet"));

      expect(addresses(notifications.teammatesFor(touchOf(S1)))).toEqual([
        contributor.relayAddress,
      ]);
      // A session no Share covers reaches nobody.
      expect(notifications.teammatesFor(touchOf(SessionId.make("s2")))).toEqual([]);

      // The issuer stops listing the phone: its registration stays, its pushes stop.
      server.list(contributing, []);

      for (let i = 0; i < 300 && notifications.teammatesFor(touchOf(S1)).length > 0; i++)
        yield* Effect.sleep("5 millis");
      expect(notifications.teammatesFor(touchOf(S1))).toEqual([]);
      expect(notifications.registered()).toBe(2);
    })
  );
});

test("a Constellation's Contributor hears of its Workers' Needs You", async () => {
  const inviteId = InviteId.make("inv_c");
  const server = await issuer([inviteId]);
  const phone = device(CONTRIBUTOR);

  await onHost(
    tempDir("pl-shares-"),
    server,
    Effect.gen(function* () {
      const notifications = yield* ShareNotifications;
      const target = ShareTarget.cases.Constellation.make({ constellationId: C1 });
      yield* share(server, inviteId, CONTRIBUTOR, "contributor", target);
      server.list(inviteId, [phone]);
      const contributor = yield* admitted(server, phone);
      yield* notifications.register(contributor, registration("t-phone"));

      expect(addresses(notifications.teammatesFor(touchOf(WORKER)))).toEqual([
        contributor.relayAddress,
      ]);
      expect(notifications.teammatesFor(touchOf(S1))).toEqual([]);
    })
  );
});

test("each person's mute is their own and outlives a restart; a refused ticket registers nothing", async () => {
  const inviteId = InviteId.make("inv_c");
  const server = await issuer([inviteId]);
  const phone = device(CONTRIBUTOR);
  const root = tempDir("pl-shares-");
  const session = ShareTarget.cases.Session.make({ sessionId: S1 });

  await onHost(
    root,
    server,
    Effect.gen(function* () {
      const notifications = yield* ShareNotifications;
      yield* share(server, inviteId, CONTRIBUTOR, "contributor");
      server.list(inviteId, [phone]);
      const contributor = yield* admitted(server, phone);

      const refused = yield* Effect.flip(
        notifications.register(contributor, registration("t", "bad"))
      );

      expect(refused.message).toBe("bad ticket");
      expect(notifications.registered()).toBe(0);

      yield* notifications.register(contributor, registration("t-phone"));
      yield* notifications.setMuted(personOf(contributor), session, true);
      expect(notifications.teammatesFor(touchOf(S1))).toEqual([]);
      // The Teammate muted it, not the owner.
      expect(notifications.muted(OWNER, touchOf(S1))).toBe(false);

      yield* notifications.setMuted(OWNER, session, true);
      expect(notifications.muted(OWNER, touchOf(S1))).toBe(true);

      const unknown = ShareTarget.cases.Session.make({ sessionId: SessionId.make("gone") });
      const missing = yield* Effect.flip(notifications.setMuted(OWNER, unknown, true));
      expect(missing.what).toBe("shared target");
    })
  );

  // The Host starts again: the registration and both mutes come back from the store.
  await onHost(
    root,
    server,
    Effect.gen(function* () {
      const notifications = yield* ShareNotifications;
      const teammate = { issuer: server.issuer, personId: CONTRIBUTOR };

      expect(notifications.registered()).toBe(1);
      expect(notifications.muted(OWNER, touchOf(S1))).toBe(true);
      expect(notifications.muted(personOf(teammate), touchOf(S1))).toBe(true);

      yield* notifications.setMuted(personOf(teammate), session, false);
      expect(notifications.muted(personOf(teammate), touchOf(S1))).toBe(false);
      expect(notifications.muted(OWNER, touchOf(S1))).toBe(true);
    })
  );
});

test("a token APNs no longer knows is forgotten; the wake that found out was sent", async () => {
  const inviteId = InviteId.make("inv_c");
  const server = await issuer([inviteId]);
  const phone = device(CONTRIBUTOR);
  const woken: Array<RelayAddress> = [];
  const outcome: WakeAnswer = { current: "unregistered" };

  await onHost(
    tempDir("pl-shares-"),
    server,
    Effect.gen(function* () {
      const notifications = yield* ShareNotifications;
      yield* share(server, inviteId, CONTRIBUTOR, "contributor");
      server.list(inviteId, [phone]);
      const contributor = yield* admitted(server, phone);
      yield* notifications.register(contributor, registration("t-phone"));
      const [target] = notifications.teammatesFor(touchOf(S1));

      if (target === undefined) throw new Error("expected the phone");
      expect(yield* notifications.wake(target, message)).toBe("unregistered");
      expect(woken).toEqual([contributor.relayAddress]);
      expect(notifications.registered()).toBe(0);
    }),
    woken,
    outcome
  );
});
