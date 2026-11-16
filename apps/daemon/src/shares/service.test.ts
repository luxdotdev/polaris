import { afterEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import {
  Actor,
  ConstellationId,
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
import { TeammateConnections } from "./connection.ts";
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

/** Runs `program` on a Host whose Shares live under `root` and ask `server` in process. */
const onHost = <A, E>(root: string, server: FakeIssuer, program: Effect.Effect<A, E, Shares>) =>
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
      });

      return yield* program;
    }).pipe(
      Effect.provide(
        Shares.layer({ fetch: server.fetch, timing: { waitS: 2, pauseMs: 5, retryMs: 20 } }).pipe(
          Layer.provide(
            Layer.mergeAll(
              ShareStore.layer(join(root, "shares.sqlite")),
              HostSecrets.memory(),
              Layer.succeed(TeammateConnections)({ serve: () => Effect.void })
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

const admits = (listed: FakeDevice) =>
  Effect.map(
    Shares,
    (shares) =>
      shares.guests.admit(Schema.decodeSync(RelayAddress)(listed.relayAddress), listed.noiseKey) !==
      null
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

    shares.guests.serve(served, listed.noiseKey);

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
      expect(shares.guests.admit(address(), phone.noiseKey)).toBeNull();

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
