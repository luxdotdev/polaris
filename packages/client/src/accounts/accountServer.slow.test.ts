/**
 * `Accounts` against two real Account Servers (apps/accounts, a fake GitHub, Postgres in
 * Docker): PKCE sign-in through each, then signing out of one.
 */
import { expect } from "bun:test";
import { Effect, Layer, Option } from "effect";
import {
  CookieJar,
  LOOPBACK,
  randomNoiseKey,
  startAccounts,
  type Accounts as AccountServerHarness,
} from "../../../../apps/accounts/src/testing/harness.ts";
import { Accounts, type Authorizer } from "./service.ts";
import { memoryAccountStore } from "./store.ts";
import { postgresSuite } from "../../../../apps/accounts/src/testing/postgresTests.ts";

const { afterAll, beforeAll, test } = postgresSuite();

let work: AccountServerHarness;

let team: AccountServerHarness;

beforeAll(async () => {
  [work, team] = await Promise.all([startAccounts(), startAccounts()]);
}, 120_000);

afterAll(async () => {
  await Promise.all([work?.stop(), team?.stop()]);
});

/** The browser half, as the harness drives it: sign `login` in on GitHub, follow redirects. */
const browserFor = (server: AccountServerHarness, login: string, id: number) =>
  Effect.sync((): Authorizer => ({
    redirectUri: LOOPBACK,
    open: (url) =>
      Effect.promise(async () => {
        server.github.signInAs({
          id,
          login,
          name: login,
          emails: [{ email: `${login}@example.com`, primary: true, verified: true }],
        });

        return (await server.browse(url, new CookieJar())).url;
      }),
  }));

test("two Accounts on different servers at once; signing out of one leaves the other", async () => {
  const store = memoryAccountStore();
  const layer = Accounts.layer({ store, fetch: (url, init) => fetch(url, init), clientId: "test" });

  const run = <A, E>(effect: Effect.Effect<A, E, Accounts>) =>
    Effect.runPromise(Effect.scoped(Effect.provide(effect, layer)));

  const { first, second, statement } = await run(
    Effect.gen(function* () {
      const accounts = yield* Accounts;
      const first = yield* accounts.signIn(work.origin, browserFor(work, "octocat", 583231));
      const second = yield* accounts.signIn(team.origin, browserFor(team, "hubot", 1001));

      return { first, second, statement: yield* accounts.statementFor(first.id, randomNoiseKey()) };
    })
  );

  expect([first.login, first.server, second.login, second.server]).toEqual([
    "octocat",
    work.origin,
    "hubot",
    team.origin,
  ]);
  expect(statement.split(".")).toHaveLength(3);

  const secondToken = Option.getOrThrow(await Effect.runPromise(store.token(second.id)));

  const after = await run(
    Effect.gen(function* () {
      const accounts = yield* Accounts;
      yield* accounts.signOut(first.id);

      return {
        list: yield* accounts.list,
        statement: yield* accounts.statementFor(second.id, randomNoiseKey()),
      };
    })
  );

  expect(after.list.map((a) => a.login)).toEqual(["hubot"]);
  expect(after.statement.split(".")).toHaveLength(3);
  expect(Option.isNone(await Effect.runPromise(store.token(first.id)))).toBe(true);

  // The other server's session is untouched; the signed-out one is gone on its server too.
  expect((await team.call("GET", "/v1/me", { token: secondToken })).status).toBe(200);
}, 60_000);

test("a session the server ended reads as signed out, keeping the Account to sign in again", async () => {
  const store = memoryAccountStore();

  const layer = Layer.fresh(
    Accounts.layer({ store, fetch: (url, init) => fetch(url, init), clientId: "test" })
  );

  const run = <A, E>(effect: Effect.Effect<A, E, Accounts>) =>
    Effect.runPromise(Effect.scoped(Effect.provide(effect, layer)));

  const signedIn = await run(
    Effect.flatMap(Accounts, (a) => a.signIn(work.origin, browserFor(work, "mona", 77)))
  );

  const token = Option.getOrThrow(await Effect.runPromise(store.token(signedIn.id)));

  await work.call("POST", "/api/auth/sign-out", { token, body: {} });

  const outcome = await run(
    Effect.gen(function* () {
      const accounts = yield* Accounts;
      const failure = yield* Effect.flip(accounts.statementFor(signedIn.id, randomNoiseKey()));

      return { reason: failure.reason, list: yield* accounts.list };
    })
  );

  expect(outcome.reason).toBe("signed-out");
  expect(outcome.list.map((a) => [a.login, a.signedOutAt !== null])).toEqual([["mona", true]]);
  expect(Option.isNone(await Effect.runPromise(store.token(signedIn.id)))).toBe(true);
}, 60_000);

test("an Invite's relay URL reaches the Teammate who accepts it; none is Polaris Cloud", async () => {
  const layer = Accounts.layer({
    store: memoryAccountStore(),
    fetch: (url, init) => fetch(url, init),
    clientId: "test",
  });

  const run = <A, E>(effect: Effect.Effect<A, E, Accounts>) =>
    Effect.runPromise(Effect.scoped(Effect.provide(effect, layer)));

  const hosts = await run(
    Effect.gen(function* () {
      const accounts = yield* Accounts;
      const owner = yield* accounts.signIn(team.origin, browserFor(team, "lisa", 2001));
      const teammate = yield* accounts.signIn(team.origin, browserFor(team, "bart", 2002));

      const share = (relayUrl: string | null) =>
        Effect.gen(function* () {
          const created = yield* accounts.createInvite(owner.id, {
            inviteeLogin: "bart",
            share: { id: crypto.randomUUID(), title: "Relay", kind: "session" },
            host: {
              name: "Desk",
              relayAddress: "relay-desk",
              noiseKey: randomNoiseKey(),
              relayUrl,
            },
            role: "commenter",
            expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          });

          const accepted = yield* accounts.accept(teammate.id, created.inviteId, {
            relayAddress: "relay-bart",
            noiseKey: randomNoiseKey(),
          });

          return [created.relayUrl, accepted.host.relayUrl];
        });

      const refused = yield* Effect.flip(share("ws://relay.example.com"));

      return {
        selfHosted: yield* share("wss://relay.example.com"),
        cloud: yield* share(null),
        refused: [refused.reason, refused.serverTag],
      };
    })
  );

  expect(hosts).toEqual({
    selfHosted: ["wss://relay.example.com", "wss://relay.example.com"],
    cloud: [null, null],
    refused: ["refused", "InvalidInvite"],
  });
}, 60_000);

test("a withdrawn Invite leaves the invitee's list and can't be accepted", async () => {
  const layer = Accounts.layer({
    store: memoryAccountStore(),
    fetch: (url, init) => fetch(url, init),
    clientId: "test",
  });

  const run = <A, E>(effect: Effect.Effect<A, E, Accounts>) =>
    Effect.runPromise(Effect.scoped(Effect.provide(effect, layer)));

  const outcome = await run(
    Effect.gen(function* () {
      const accounts = yield* Accounts;
      const owner = yield* accounts.signIn(team.origin, browserFor(team, "marge", 2101));
      const teammate = yield* accounts.signIn(team.origin, browserFor(team, "homer", 2102));

      const created = yield* accounts.createInvite(owner.id, {
        inviteeLogin: "homer",
        share: { id: crypto.randomUUID(), title: "Withdrawn", kind: "session" },
        host: { name: "Desk", relayAddress: "relay-desk", noiseKey: randomNoiseKey() },
        role: "contributor",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });

      const before = yield* accounts.invites(teammate.id);
      yield* accounts.withdrawInvite(owner.id, created);

      const accept = yield* Effect.flip(
        accounts.accept(teammate.id, created.inviteId, {
          relayAddress: "relay-homer",
          noiseKey: randomNoiseKey(),
        })
      );

      const after = yield* accounts.invites(teammate.id);

      const listed = (all: ReadonlyArray<{ readonly inviteId: string }>) =>
        all.some((i) => i.inviteId === created.inviteId);

      return { before: listed(before), after: listed(after), accept: accept.serverTag };
    })
  );

  expect(outcome).toEqual({ before: true, after: false, accept: "InviteClosed" });
}, 60_000);
