import { describe, expect, test } from "bun:test";
import { POLARIS_CLOUD_ACCOUNTS_URL } from "@polaris/protocol";
import { Effect, Exit, Option, Schema, Stream, SubscriptionRef } from "effect";
import { fakeAccountServer, fakeServers } from "./accounts.testing.ts";
import { AcceptedInvite, CreatedInvite } from "./contract.ts";
import { accountServerOrigin } from "./server.ts";
import { Accounts, workspaceAccountKey } from "./service.ts";
import { type AccountStore, memoryAccountStore } from "./store.ts";

const cloud = fakeAccountServer(POLARIS_CLOUD_ACCOUNTS_URL);

const run = <A, E>(
  store: AccountStore,
  effect: Effect.Effect<A, E, Accounts>,
  fetch = fakeServers(cloud)
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.provide(
        effect,
        Accounts.layer({ store, fetch, clientId: "polaris-test", devicePollFloorS: 0 })
      )
    )
  );

describe("accountServerOrigin", () => {
  test.each([
    ["auth.example.com", "https://auth.example.com"],
    ["https://auth.example.com/", "https://auth.example.com"],
    ["http://localhost:3000", "http://localhost:3000"],
    ["http://127.0.0.1:3000/", "http://127.0.0.1:3000"],
  ])("%s is the issuer %s", async (input, origin) => {
    expect(await Effect.runPromise(accountServerOrigin(input))).toBe(origin);
  });

  test.each([
    "http://auth.example.com",
    "https://auth.example.com/accounts",
    "https://user:pw@auth.example.com",
    "https://auth.example.com/?x=1",
    "not a url at all",
  ])("%s is refused", async (input) => {
    const exit = await Effect.runPromiseExit(accountServerOrigin(input));

    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("signing in", () => {
  test("a redirect with another sign-in's state is refused before any code is traded", async () => {
    const server = fakeAccountServer("https://a.example");
    const store = memoryAccountStore();

    const failure = await run(
      store,
      Effect.flip(
        Effect.flatMap(Accounts, (a) => a.signIn(server.origin, server.browser({ state: "x" })))
      ),
      fakeServers(server)
    );

    expect(failure.reason).toBe("sign-in-failed");
    expect(server.calls).toEqual([]);
    expect((await Effect.runPromise(store.read)).accounts).toEqual([]);
  });

  test("signing the same person in again keeps one Account and replaces its token", async () => {
    const store = memoryAccountStore();

    const [first, again, list] = await run(
      store,
      Effect.gen(function* () {
        const accounts = yield* Accounts;
        const first = yield* accounts.signIn(cloud.origin, cloud.browser());
        const again = yield* accounts.signIn(cloud.origin, cloud.browser());

        return [first, again, yield* accounts.list] as const;
      })
    );

    expect(again.id).toBe(first.id);
    expect(list).toHaveLength(1);
    expect(Option.getOrThrow(await Effect.runPromise(store.token(first.id)))).not.toBe("");
  });

  test("the device code signs in once someone approves it on a browser", async () => {
    const server = fakeAccountServer("https://b.example");
    const store = memoryAccountStore();

    const { flow, list } = await run(
      store,
      Effect.gen(function* () {
        const accounts = yield* Accounts;
        const flow = yield* accounts.startDeviceSignIn(server.origin);
        server.approveDevice({ personId: "p9", login: "hubot" });
        yield* SubscriptionRef.changes(accounts.state).pipe(
          Stream.filter((s) => s.accounts.length > 0),
          Stream.runHead
        );

        return { flow, list: yield* accounts.list };
      }),
      fakeServers(server)
    );

    expect(flow.userCode).toBe("ABCD-EFGH");
    expect(flow.verificationUri).toBe(`${server.origin}/device?user_code=ABCD-EFGH`);
    expect(list.map((a) => [a.server, a.login])).toEqual([[server.origin, "hubot"]]);
  });

  test.each([
    ["https://b.example", "file:///etc/passwd"],
    ["https://b.example", "polaris://session/a/b"],
    ["https://b.example", "javascript:alert(1)"],
    ["https://b.example", "https://evil.example/device?user_code=ABCD-EFGH"],
    ["https://b.example", "http://b.example/device"],
    ["https://b.example", "https://user:pw@b.example/device"],
    ["http://localhost:4100", "http://localhost:4101/device"],
  ])("a device sign-in from %s refuses the verification URI %s", async (origin, uri) => {
    const server = fakeAccountServer(origin, { verificationUri: uri });
    const store = memoryAccountStore();

    const [failure, state] = await run(
      store,
      Effect.gen(function* () {
        const accounts = yield* Accounts;
        const failure = yield* Effect.flip(accounts.startDeviceSignIn(server.origin));

        return [failure, yield* SubscriptionRef.get(accounts.state)] as const;
      }),
      fakeServers(server)
    );

    expect(failure.reason).toBe("sign-in-failed");
    expect(failure.message).toBe("the Account Server sent a sign-in page that isn't its own");
    expect(state.deviceSignIn).toBeNull();
  });

  test("a local Account Server's device sign-in may use http on loopback", async () => {
    const server = fakeAccountServer("http://localhost:4100");

    const flow = await run(
      memoryAccountStore(),
      Effect.flatMap(Accounts, (a) => a.startDeviceSignIn(server.origin)),
      fakeServers(server)
    );

    expect(flow.verificationUri).toBe("http://localhost:4100/device?user_code=ABCD-EFGH");
  });
});

describe("a Workspace's sharing Account", () => {
  const workspace = workspaceAccountKey("studio", "w1");

  test("persists across a restart, and goes with its Account's sign-out", async () => {
    const store = memoryAccountStore();
    const other = fakeAccountServer("https://c.example");
    const fetch = fakeServers(cloud, other);

    const ids = await run(
      store,
      Effect.gen(function* () {
        const accounts = yield* Accounts;
        const a = yield* accounts.signIn(cloud.origin, cloud.browser());
        const b = yield* accounts.signIn(other.origin, other.browser());
        yield* accounts.setWorkspaceAccount(workspace, b.id);

        return { a: a.id, b: b.id };
      }),
      fetch
    );

    const restarted = await run(
      store,
      Effect.flatMap(Accounts, (a) => a.workspaceAccount(workspace)),
      fetch
    );

    expect(Option.getOrNull(restarted)).toBe(ids.b);

    const afterSignOut = await run(
      store,
      Effect.gen(function* () {
        const accounts = yield* Accounts;
        yield* accounts.signOut(ids.b);

        return {
          workspace: yield* accounts.workspaceAccount(workspace),
          list: yield* accounts.list,
        };
      }),
      fetch
    );

    expect(Option.isNone(afterSignOut.workspace)).toBe(true);
    expect(afterSignOut.list.map((a) => a.id)).toEqual([ids.a]);
  });

  test("can't name an Account that isn't here", async () => {
    const failure = await run(
      memoryAccountStore(),
      Effect.flip(Effect.flatMap(Accounts, (a) => a.setWorkspaceAccount(workspace, "nope")))
    );

    expect(failure.reason).toBe("unknown-account");
  });
});

describe("the Invite contract", () => {
  test("an Account Server that sends no relayUrl reads as Polaris Cloud", () => {
    const host = { name: "Desk", relayAddress: "relay-desk", noiseKey: "k" };

    const accepted = Schema.decodeUnknownSync(AcceptedInvite)({
      host,
      share: { id: "s", title: "t", kind: "session" },
      role: "contributor",
      owner: { personId: "p", login: "lisa", name: null, avatarUrl: null },
    });

    const created = Schema.decodeUnknownSync(CreatedInvite)({ inviteId: "i", hostCapability: "c" });

    expect([accepted.host.relayUrl, created.relayUrl]).toEqual([null, null]);
  });
});
