import { afterEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import {
  Actor,
  ConstellationId,
  encodeTeammateInit,
  InviteId,
  type NotFound,
  PersonId,
  SessionId,
  type Share,
  type ShareRefused,
  ShareTarget,
  type StatementRejected,
} from "@polaris/protocol";
import { RelayAddress, toBase64Url } from "@polaris/protocol/relay";
import {
  acceptHandshake,
  generateStaticKeyPair,
  RelayInitiator,
} from "@polaris/protocol/relay/party";
import { Effect, Layer, Redacted, Schema } from "effect";
import { DeviceSession } from "../linkedDevices/session.ts";
import { tempDir } from "../platform/tempDir.testing.ts";
import { HostSecrets } from "../secrets/index.ts";
import { TeammateConnections, type TeammateDevice } from "./connection.ts";
import {
  type FakeDevice,
  type FakeIssuer,
  startFakeIssuer,
  type StatementOptions,
} from "./issuer.testing.ts";
import { Shares } from "./service.ts";

type CreateInput = Parameters<Shares["Service"]["create"]>[0];

import { ShareStore } from "./store.ts";

const OWNER = Actor.cases.Client.make({});

const S1 = SessionId.make("s1");

const PERSON = PersonId.make("p1");

const INVITE = InviteId.make("inv_1");

const CAPABILITY = "cap_secret";

const servers: Array<FakeIssuer> = [];

afterEach(() => {
  servers.splice(0).forEach((server) => server.stop());
});

const issuer = async () => {
  const server = await startFakeIssuer();
  servers.push(server);
  server.invite(INVITE, CAPABILITY);

  return server;
};

const key = () => randomBytes(32).toString("base64url");

const address = () => Schema.decodeSync(RelayAddress)(randomBytes(16).toString("base64url"));

const device = (statement?: StatementOptions): FakeDevice => ({
  personId: PERSON,
  relayAddress: address(),
  noiseKey: key(),
  statement,
});

/**
 * Runs `program` on a Host whose Shares live under `root` and ask `server` in process; each
 * Teammate it serves a connection for is added to `served`.
 */
const onHost = <A, E>(
  root: string,
  server: FakeIssuer,
  program: Effect.Effect<A, E, Shares>,
  served: Array<TeammateDevice> = []
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const shares = yield* Shares;

      shares.bindTargets({
        session: (id) =>
          Effect.succeed(
            id === S1 || id === "worker"
              ? {
                  touch: { sessionId: id, constellationId: null },
                  cwd: "/repo",
                  worker: id === "worker",
                }
              : null
          ),
        hasConstellation: (id) => Effect.succeed(id === "c1"),
        turn: () => Effect.succeed(null),
      });

      return yield* program;
    }).pipe(
      Effect.provide(
        Shares.layer({
          fetch: server.fetch,
          timing: { waitS: 2, pauseMs: 5, retryMs: 20 },
          skewMs: 0,
        }).pipe(
          Layer.provide(
            Layer.mergeAll(
              ShareStore.layer(join(root, "shares.sqlite")),
              HostSecrets.memory(),
              Layer.succeed(TeammateConnections)({
                serve: (_session, teammate) =>
                  Effect.sync(() => {
                    served.push(teammate);
                  }),
              })
            )
          )
        )
      ),
      Effect.scoped
    )
  );

const invite = (server: FakeIssuer, fields: Partial<CreateInput> = {}) => ({
  target: ShareTarget.cases.Session.make({ sessionId: S1 }),
  personId: PERSON,
  inviteeLogin: "octocat",
  role: "contributor" as const,
  expiresAt: null,
  issuer: server.issuer,
  inviteId: INVITE,
  hostCapability: Redacted.make(CAPABILITY),
  ...fields,
});

const until = (probe: () => boolean, what: string) =>
  Effect.gen(function* () {
    for (let i = 0; i < 300; i++) {
      if (probe()) return;
      yield* Effect.sleep("5 millis");
    }

    return yield* Effect.die(new Error(`timed out waiting for ${what}`));
  });

/** A handshake whose init names nobody, as a Client before ENG-941's two Accounts sends. */
const NO_PAYLOAD = new Uint8Array();

const admits = (listed: FakeDevice) =>
  Effect.map(
    Shares,
    (shares) =>
      shares.guests.admit(
        Schema.decodeSync(RelayAddress)(listed.relayAddress),
        listed.noiseKey,
        NO_PAYLOAD
      ) !== null
  );

/** "accepted", a refusal's reason, or what a NotFound did not find. */
/** A device with a real Noise key, and its session as the relay link would hand it over. */
const withSession = () => {
  const host = generateStaticKeyPair();
  const noise = generateStaticKeyPair();
  const listed = { ...device(), noiseKey: toBase64Url(noise.publicKey) };

  const { session } = acceptHandshake(
    host,
    new RelayInitiator(noise, host.publicKey).init,
    () => true
  );

  const serve = (shares: Shares["Service"]) => {
    const served = new DeviceSession(
      Schema.decodeSync(RelayAddress)(listed.relayAddress),
      session,
      {
        send: () => Promise.resolve(),
        ended: (ended) => shares.guests.ended(ended),
      }
    );

    const guestId = shares.guests.admit(served.peer, listed.noiseKey, NO_PAYLOAD);

    if (guestId === null) throw new Error("the device was not admitted");
    shares.guests.serve(served, guestId);

    return served;
  };

  return { listed, serve };
};

const refusalOf = <A, R>(
  effect: Effect.Effect<A, NotFound | ShareRefused | StatementRejected, R>
) =>
  effect.pipe(
    Effect.map(() => "accepted"),
    Effect.catchTag("NotFound", (error) => Effect.succeed(error.what)),
    Effect.catch((error) => Effect.succeed(error.reason))
  );

test("a live Share lists and admits the device its issuer vouches for, and logs the acceptance", async () => {
  const server = await issuer();
  const phone = device();

  await onHost(
    tempDir("pl-shares-"),
    server,
    Effect.gen(function* () {
      const shares = yield* Shares;
      const share = yield* shares.create(invite(server), OWNER);

      expect(share.person).toMatchObject({ id: PERSON, login: "octocat", commitEmail: null });
      expect(yield* admits(phone)).toBe(false);

      server.list(INVITE, [phone]);
      yield* until(() => shares.guests.peers().length === 1, "the device to be listed");

      expect(shares.guests.peers()).toEqual([Schema.decodeSync(RelayAddress)(phone.relayAddress)]);
      expect(yield* admits(phone)).toBe(true);
      // The key is admitted only from the address the issuer listed it at.
      expect(shares.guests.admit(address(), phone.noiseKey, NO_PAYLOAD)).toBeNull();

      const [listing] = yield* shares.list(null);

      expect(listing?.log.map((entry) => entry._tag)).toEqual(["Invited", "Accepted"]);
      expect(listing?.share.person).toMatchObject({
        id: PERSON,
        name: "The Octocat",
        commitEmail: "octocat@github.test",
      });
    })
  );
});

test("a device key under two persons is admitted as the one its handshake names, and each statement reaches only its own person's Shares", async () => {
  const server = await issuer();
  const WORK = PersonId.make("p-work");
  const WORK_INVITE = InviteId.make("inv_work");
  const phone = device();
  const at = Schema.decodeSync(RelayAddress)(phone.relayAddress);
  server.invite(WORK_INVITE, CAPABILITY);

  await onHost(
    tempDir("pl-shares-"),
    server,
    Effect.gen(function* () {
      const shares = yield* Shares;
      const personal = yield* shares.create(invite(server), OWNER);

      const work = yield* shares.create(
        invite(server, {
          personId: WORK,
          inviteId: WORK_INVITE,
          target: ShareTarget.cases.Constellation.make({
            constellationId: ConstellationId.make("c1"),
          }),
        }),
        OWNER
      );

      // One device, signed in to both Accounts: the same key and address under each person.
      server.list(INVITE, [phone]);
      server.list(WORK_INVITE, [{ ...phone, personId: WORK }]);

      const as = (personId: PersonId, issuer = server.issuer) =>
        shares.guests.admit(at, phone.noiseKey, encodeTeammateInit({ issuer, personId }));

      yield* until(() => as(PERSON) !== null && as(WORK) !== null, "both persons to be listed");

      // Each named person has its own guest; a person or issuer the key isn't listed for has none.
      expect(as(PERSON)).not.toBe(as(WORK));
      expect(as(PersonId.make("p-other"))).toBeNull();
      expect(as(PERSON, "https://other.test")).toBeNull();

      const device = (personId: PersonId) => ({
        issuer: server.issuer,
        personId,
        noiseKey: phone.noiseKey,
        relayAddress: at,
      });

      const statementOf = (personId: PersonId) =>
        Effect.map(
          Effect.promise(() => server.statement(personId, phone.noiseKey)),
          Redacted.make
        );

      const reached = (connection: PersonId, statement: PersonId) =>
        Effect.flatMap(statementOf(statement), (presented) =>
          shares.present(device(connection), presented).pipe(
            Effect.map((standing) => standing.shares.map((share) => share.id)),
            Effect.catch((error) => Effect.succeed(error.reason))
          )
        );

      expect(yield* reached(PERSON, PERSON)).toEqual([personal.id]);
      expect(yield* reached(WORK, WORK)).toEqual([work.id]);
      expect(yield* reached(PERSON, WORK)).toBe("person");
      expect(yield* reached(WORK, PERSON)).toBe("person");
      expect(shares.sharesOf(device(PERSON)).map((share) => share.id)).toEqual([personal.id]);
      expect(shares.sharesOf(device(WORK)).map((share) => share.id)).toEqual([work.id]);
    })
  );
});

test("a handshake that names nobody on a key with two persons is admitted as neither, whatever statement it presents", async () => {
  const server = await issuer();
  const WORK = PersonId.make("p-work");
  const WORK_INVITE = InviteId.make("inv_work");
  const { listed: phone, serve } = withSession();
  server.invite(WORK_INVITE, CAPABILITY);

  const served: Array<TeammateDevice> = [];

  await onHost(
    tempDir("pl-shares-"),
    server,
    Effect.gen(function* () {
      const shares = yield* Shares;
      yield* shares.create(invite(server), OWNER);
      yield* shares.create(invite(server, { personId: WORK, inviteId: WORK_INVITE }), OWNER);
      server.list(INVITE, [phone]);
      yield* until(() => shares.guests.peers().length === 1, "the first person to be listed");

      // Under one person the key is that person, as before.
      serve(shares);
      expect(served.map((device) => device.personId)).toEqual([PERSON]);

      server.list(WORK_INVITE, [{ ...phone, personId: WORK }]);

      const named = () =>
        shares.guests.admit(
          Schema.decodeSync(RelayAddress)(phone.relayAddress),
          phone.noiseKey,
          encodeTeammateInit({ issuer: server.issuer, personId: WORK })
        );

      yield* until(() => named() !== null, "the second person to be listed");
      serve(shares);

      const unnamed = served.at(-1);

      if (unnamed === undefined || served.length !== 2) throw new Error("no second session");

      expect(shares.sharesOf(unnamed)).toEqual([]);
      expect(yield* refusalOf(shares.standing(unnamed))).toBe("person");

      for (const personId of [PERSON, WORK]) {
        const statement = yield* Effect.promise(() => server.statement(personId, phone.noiseKey));

        expect(yield* refusalOf(shares.present(unnamed, Redacted.make(statement)))).toBe("person");
      }
    }),
    served
  );
});

const unvouched: ReadonlyArray<readonly [string, FakeDevice]> = [
  ["whose statement another key signed", device({ forged: true })],
  ["whose statement another issuer issued", device({ iss: "https://evil.test" })],
  ["whose statement names another person", device({ sub: "p2" })],
  ["whose statement is stale", device({ ttlS: -5 })],
  ["whose statement names another device", device({ noiseKey: key() })],
  ["that the issuer lists for another person", { ...device(), personId: "p2" }],
];

test.each(unvouched)("a device %s is neither listed nor admitted", async (_, listed) => {
  const server = await issuer();
  const honest = device();

  await onHost(
    tempDir("pl-shares-"),
    server,
    Effect.gen(function* () {
      const shares = yield* Shares;
      yield* shares.create(invite(server), OWNER);
      // The honest device after it proves the whole list was read.
      server.list(INVITE, [listed, honest]);
      yield* until(() => shares.guests.peers().length > 0, "the list to be read");

      expect(yield* admits(honest)).toBe(true);
      expect(yield* admits(listed)).toBe(false);
      expect(shares.guests.peers()).toHaveLength(1);
    })
  );
});

test("revoking ends the person's session and stops admitting the device at once, and ends the poll and the capability", async () => {
  const server = await issuer();
  const { listed: phone, serve } = withSession();

  await onHost(
    tempDir("pl-shares-"),
    server,
    Effect.gen(function* () {
      const shares = yield* Shares;
      const share = yield* shares.create(invite(server), OWNER);
      server.list(INVITE, [phone]);
      yield* until(() => shares.guests.peers().length === 1, "the device to be listed");
      const session = serve(shares);

      expect(session.isClosed).toBe(false);
      const revoked = yield* shares.revoke(share.id, OWNER);

      // The person's open session is over by the time the owner has their answer.
      expect(session.isClosed).toBe(true);
      expect(revoked.revokedAt).not.toBeNull();
      expect(yield* admits(phone)).toBe(false);
      expect(shares.guests.peers()).toEqual([]);
      yield* until(() => server.revoked(INVITE), "the capability to be ended");

      const asked = server.polls();
      yield* Effect.sleep("50 millis");

      expect(server.polls()).toBe(asked);
      expect((yield* shares.list(null))[0]?.log.at(-1)?._tag).toBe("Revoked");
      expect(yield* refusalOf(shares.renew(share.id, null, OWNER))).toBe("ended");
    })
  );
});

test("a Host whose Shares have all ended asks no issuer anything", async () => {
  const server = await issuer();
  const root = tempDir("pl-shares-");

  await onHost(
    root,
    server,
    Effect.gen(function* () {
      const shares = yield* Shares;
      const share = yield* shares.create(invite(server), OWNER);
      yield* shares.revoke(share.id, OWNER);
    })
  );

  const asked = server.polls();
  const keys = server.jwksFetches();

  // The Daemon starts again with only the revoked Share in its store.
  await onHost(root, server, Effect.sleep("50 millis"));

  expect(server.polls()).toBe(asked);
  expect(server.jwksFetches()).toBe(keys);
});

test("a Share that expires ends its session, stops admitting its device and logs it; renewing admits it again", async () => {
  const server = await issuer();
  const { listed: phone, serve } = withSession();

  await onHost(
    tempDir("pl-shares-"),
    server,
    Effect.gen(function* () {
      const shares = yield* Shares;
      const soon = new Date(Date.now() + 150).toISOString();
      const share = yield* shares.create(invite(server, { expiresAt: soon }), OWNER);
      server.list(INVITE, [phone]);
      yield* until(() => shares.guests.peers().length === 1, "the device to be listed");
      const session = serve(shares);
      yield* until(() => shares.guests.peers().length === 0, "the Share to expire");

      expect(session.isClosed).toBe(true);

      expect(yield* admits(phone)).toBe(false);
      expect((yield* shares.list(null))[0]?.log.at(-1)?._tag).toBe("Expired");

      const renewed: Share = yield* shares.renew(share.id, null, OWNER);

      expect(Date.parse(renewed.expiresAt)).toBeGreaterThan(Date.now() + 60_000);
      yield* until(() => shares.guests.peers().length === 1, "the device to be listed again");
      expect(yield* admits(phone)).toBe(true);
    })
  );
});

test("a Share is refused for a wrong capability, an unreachable or insecure issuer, a bad expiry and a Worker", async () => {
  const server = await issuer();

  await onHost(
    tempDir("pl-shares-"),
    server,
    Effect.gen(function* () {
      const shares = yield* Shares;

      const create = (fields: Partial<CreateInput>) =>
        refusalOf(shares.create(invite(server, fields), OWNER));

      expect(yield* create({ hostCapability: Redacted.make("wrong") })).toBe("invite");
      expect(yield* create({ issuer: "http://accounts.example" })).toBe("issuer-unreachable");
      expect(yield* create({ expiresAt: "2020-01-01T00:00:00.000Z" })).toBe("expiry");
      expect(
        yield* create({
          target: ShareTarget.cases.Session.make({ sessionId: SessionId.make("worker") }),
        })
      ).toBe("worker");
      expect(
        yield* create({
          target: ShareTarget.cases.Session.make({ sessionId: SessionId.make("gone") }),
        })
      ).toBe("session");
      expect(
        yield* create({
          target: ShareTarget.cases.Constellation.make({
            constellationId: ConstellationId.make("c9"),
          }),
        })
      ).toBe("constellation");

      server.down = true;
      expect(yield* create({})).toBe("issuer-unreachable");
      expect(yield* shares.list(null)).toEqual([]);
    })
  );
});

test("a device's own newer statement is taken only for that device and person", async () => {
  const server = await issuer();
  const phone = device({ ttlS: 30 });

  await onHost(
    tempDir("pl-shares-"),
    server,
    Effect.gen(function* () {
      const shares = yield* Shares;
      yield* shares.create(invite(server), OWNER);
      server.list(INVITE, [phone]);
      yield* until(() => shares.guests.peers().length === 1, "the device to be listed");

      const teammate = {
        issuer: server.issuer,
        personId: PERSON,
        noiseKey: phone.noiseKey,
        relayAddress: Schema.decodeSync(RelayAddress)(phone.relayAddress),
      };

      const present = (personId: string, noiseKey: string, options?: StatementOptions) =>
        Effect.flatMap(
          Effect.promise(() => server.statement(personId, noiseKey, options)),
          (statement) => shares.present(teammate, Redacted.make(statement))
        );

      const before = Date.parse((yield* shares.standing(teammate)).expiresAt);
      const after = Date.parse((yield* present(PERSON, phone.noiseKey)).expiresAt);

      expect(after).toBeGreaterThan(before + 60_000);
      expect(yield* refusalOf(present(PERSON, key()))).toBe("device");
      expect(yield* refusalOf(present("p2", phone.noiseKey))).toBe("person");
      expect(yield* refusalOf(present(PERSON, phone.noiseKey, { forged: true }))).toBe("signature");
    })
  );
});

test("a session ends when its device's statement lapses or the issuer no longer lists it", async () => {
  const server = await issuer();
  const lapsing = withSession();
  const leaving = withSession();

  await onHost(
    tempDir("pl-shares-"),
    server,
    Effect.gen(function* () {
      const shares = yield* Shares;
      yield* shares.create(invite(server), OWNER);
      server.list(INVITE, [{ ...lapsing.listed, statement: { ttlS: 1 } }, leaving.listed]);
      yield* until(() => shares.guests.peers().length === 2, "both devices to be listed");
      const lapsed = lapsing.serve(shares);
      const left = leaving.serve(shares);

      // The list as the issuer has it once the second device's session ended there.
      server.list(INVITE, [{ ...lapsing.listed, statement: { ttlS: -5 } }]);
      yield* until(() => left.isClosed, "the unlisted device's session to end");
      yield* until(() => lapsed.isClosed, "the lapsed statement's session to end");

      expect(shares.guests.peers()).toEqual([]);
    })
  );
});

test("a device one Share stops listing loses that Share and its open session, and keeps the other", async () => {
  const server = await issuer();
  const other = InviteId.make("inv_2");
  server.invite(other, CAPABILITY);
  const phone = withSession();

  await onHost(
    tempDir("pl-shares-"),
    server,
    Effect.gen(function* () {
      const shares = yield* Shares;
      const first = yield* shares.create(invite(server), OWNER);
      const second = yield* shares.create(invite(server, { inviteId: other }), OWNER);

      const teammate = {
        issuer: server.issuer,
        personId: PERSON,
        noiseKey: phone.listed.noiseKey,
        relayAddress: Schema.decodeSync(RelayAddress)(phone.listed.relayAddress),
      };

      const mine = () => shares.sharesOf(teammate).map((share) => share.id);

      server.list(INVITE, [phone.listed]);
      server.list(other, [phone.listed]);
      yield* until(() => mine().length === 2, "both Shares to list the device");
      const open = phone.serve(shares);

      // The first Share's Invite no longer lists the phone; the second still does.
      server.list(INVITE, []);
      yield* until(() => open.isClosed, "the session that held the first Share to end");

      expect(mine()).toEqual([second.id]);
      expect(mine()).not.toContain(first.id);
      expect(yield* admits(phone.listed)).toBe(true);
      expect(phone.serve(shares).isClosed).toBe(false);
    })
  );
});

test("a Share lives at most 30 days, when it is created and each time it is renewed", async () => {
  const server = await issuer();
  const days = (count: number) => new Date(Date.now() + count * 24 * 3_600_000).toISOString();

  await onHost(
    tempDir("pl-shares-"),
    server,
    Effect.gen(function* () {
      const shares = yield* Shares;

      expect(yield* refusalOf(shares.create(invite(server, { expiresAt: days(31) }), OWNER))).toBe(
        "expiry"
      );

      const share = yield* shares.create(invite(server, { expiresAt: days(2) }), OWNER);

      expect(yield* refusalOf(shares.renew(share.id, days(31), OWNER))).toBe("expiry");
      const renewed = yield* shares.renew(share.id, days(29), OWNER);

      expect(Date.parse(renewed.expiresAt)).toBeGreaterThan(Date.parse(share.expiresAt));
      expect((yield* shares.list(null))[0]?.share.expiresAt).toBe(renewed.expiresAt);
    })
  );
});
