import { expect, test } from "bun:test";
import { type HostConnection, HostTarget } from "@polaris/client";
import {
  type AcceptedInvite,
  type AccountRecord,
  AccountsError,
  type AccountsApi,
} from "@polaris/client/accounts";
import { Effect, Redacted, SubscriptionRef } from "effect";
import type { HostView } from "../../shared/api.ts";
import type { HostDirectory, HostEntry } from "../hosts.ts";
import { memorySharedStore, type SharedEntry, sharedHostKey } from "./store.ts";
import { hostsToCheck, teammateSharing, withMeView } from "./teammate.ts";

/** A fake of only what the code under test calls. */
// SAFETY: each test names the members its path reads; a call to any other would throw.
const only = <T>(part: Partial<T>): T => part as T;

const RELAY = "AAAAAAAAAAAAAAAAAAAAAA";

const KEY = sharedHostKey({ accountId: "a1", host: { relayAddress: RELAY } });

const entry = (inviteId: string, sessionId: string): SharedEntry => ({
  accountId: "a1",
  inviteId,
  owner: { login: "lucas", name: "Lucas", avatarUrl: null },
  host: { name: "Mac Studio", relayAddress: RELAY, noiseKey: "k" },
  sessionId,
  title: "Fix login",
  role: "contributor",
  acceptedAt: 5,
});

const unreachable = (attempt: number): HostView => ({
  key: KEY,
  label: "Mac Studio",
  colour: null,
  alias: null,
  kind: "relay",
  proofHarness: false,
  shared: true,
  status: {
    state: "reconnecting",
    failure: { kind: "transient", reason: "unreachable", detail: "" },
    attempt,
    since: 7,
    nextAttemptAt: null,
    host: null,
    capabilities: [],
    epoch: 0,
    latencyMs: null,
    lastSeenAt: null,
  },
});

/** A Teammate's sharing over an Account Server that answers each Invite as told. */
const setup = async (
  entries: ReadonlyArray<SharedEntry>,
  answer: (inviteId: string) => Effect.Effect<AcceptedInvite, AccountsError>
) => {
  const store = memorySharedStore(entries);
  const shared = await Effect.runPromise(SubscriptionRef.make(entries));

  const teammate = teammateSharing({
    hosts: only<HostDirectory["Service"]>({}),
    accounts: only<AccountsApi>({ accept: (_account, inviteId) => answer(inviteId) }),
    store,
    shared,
    deviceKeys: Effect.succeed({ relayAddress: "me", noiseKey: "mine" }),
    defaultRelayUrl: "wss://relay.example/v1",
    avatar: () => null,
    now: () => 99,
  });

  return { teammate, store };
};

const ACCEPTED: AcceptedInvite = {
  host: { name: "Mac Studio", relayAddress: RELAY, noiseKey: "k", relayUrl: null },
  share: { id: "s1", title: "Fix login", kind: "session" },
  role: "commenter",
  owner: { personId: "p-lucas", login: "lucas", name: "Lucas", avatarUrl: null },
};

const account = (id: string, server: string, personId: string): AccountRecord => ({
  id,
  server,
  personId,
  login: id,
  name: null,
  avatarUrl: null,
  commitEmail: `${id}@example.com`,
  commitEmails: [],
  signedInAt: 1,
  signedOutAt: null,
});

const closed = (serverTag: string) =>
  Effect.fail(
    new AccountsError({ reason: "refused", message: "This invite was revoked.", serverTag })
  );

test("a revoked Share on a Host that stopped answering reads ended, not offline, and isn't asked about again", async () => {
  const { teammate, store } = await setup([entry("inv-1", "s1")], () => closed("InviteClosed"));

  await Effect.runPromise(teammate.checkStanding(KEY));
  const kept = await Effect.runPromise(store.read);

  expect(kept.map((s) => s.endedAt)).toEqual([99]);

  const session = withMeView({
    accounts: [],
    invites: new Map(),
    shared: kept,
    hosts: [unreachable(1)],
    avatar: () => null,
  }).sessions[0];

  expect(session).toMatchObject({ ended: true, hostOffline: false });
  expect(hostsToCheck(kept, [unreachable(2)])).toEqual([]);
});

test("only the revoked Share ends on a Host with another still standing", async () => {
  const { teammate, store } = await setup(
    [entry("inv-1", "s1"), entry("inv-2", "s2")],
    (inviteId) => (inviteId === "inv-1" ? closed("InviteClosed") : Effect.succeed(ACCEPTED))
  );

  await Effect.runPromise(teammate.checkStanding(KEY));

  const kept = await Effect.runPromise(store.read);

  expect(kept.map((s) => s.endedAt)).toEqual([99, undefined]);
  // The Host is still asked about while one of its Shares stands.
  expect(hostsToCheck(kept, [unreachable(2)]).map((h) => h.hostKey)).toEqual([KEY]);
});

test("an Account Server that can't be reached leaves an offline Host's Share standing", async () => {
  const { teammate, store } = await setup([entry("inv-1", "s1")], () =>
    Effect.fail(new AccountsError({ reason: "unreachable", message: "Couldn't reach it." }))
  );

  await Effect.runPromise(teammate.checkStanding(KEY));

  expect((await Effect.runPromise(store.read))[0]?.endedAt).toBeUndefined();
  // Asked again on the next attempt of the same outage.
  expect(hostsToCheck([entry("inv-1", "s1")], [unreachable(1)])).not.toEqual(
    hostsToCheck([entry("inv-1", "s1")], [unreachable(2)])
  );
});

test("accepting a new Invite from a Host whose Share ended dials it again at once and clears ended", async () => {
  const store = memorySharedStore([{ ...entry("inv-1", "s1"), endedAt: 50 }]);
  const shared = await Effect.runPromise(SubscriptionRef.make(await Effect.runPromise(store.read)));
  let retries = 0;

  const teammate = teammateSharing({
    hosts: only<HostDirectory["Service"]>({
      add: () => Effect.void,
      connection: () =>
        Effect.succeed(only<HostConnection>({ retryNow: Effect.sync(() => void retries++) })),
    }),
    accounts: only<AccountsApi>({
      accept: () => Effect.succeed(ACCEPTED),
      list: Effect.succeed([account("a1", "https://accounts.example", "p-me")]),
    }),
    store,
    shared,
    deviceKeys: Effect.succeed({ relayAddress: "me", noiseKey: "mine" }),
    defaultRelayUrl: "wss://relay.example/v1",
    avatar: () => null,
    now: () => 99,
  });

  await Effect.runPromise(teammate.accept("a1", "inv-2"));
  const kept = await Effect.runPromise(store.read);

  expect(kept.map((s) => [s.inviteId, s.role, s.endedAt])).toEqual([
    ["inv-2", "commenter", undefined],
  ]);
  expect(retries).toBe(1);
});

/** A Teammate signed in to two Accounts, with what each connection to a Host was dialled as. */
const twoAccounts = async (entries: ReadonlyArray<SharedEntry>) => {
  const store = memorySharedStore(entries);
  const shared = await Effect.runPromise(SubscriptionRef.make(entries));
  const added: Array<HostEntry> = [];

  const teammate = teammateSharing({
    hosts: only<HostDirectory["Service"]>({
      add: (host) => Effect.sync(() => void added.push(host)),
    }),
    accounts: only<AccountsApi>({
      accept: () => Effect.succeed(ACCEPTED),
      list: Effect.succeed([
        account("personal", "https://accounts.example", "p-me"),
        account("work", "https://accounts.corp.example", "p-employee"),
      ]),
      statementFor: (accountId, noiseKey) => Effect.succeed(`${accountId} for ${noiseKey}`),
    }),
    store,
    shared,
    deviceKeys: Effect.succeed({ relayAddress: "me", noiseKey: "mine" }),
    defaultRelayUrl: "wss://relay.example/v1",
    avatar: () => null,
    now: () => 99,
  });

  /** Each connection: its Host key, who its handshake names and the statement it presents. */
  const dialled = () =>
    Effect.runPromise(
      Effect.forEach(added, (host) =>
        Effect.map(host.teammate?.accountStatement ?? Effect.succeed(null), (statement) => ({
          key: host.key,
          as: HostTarget.$is("Relay")(host.target) ? host.target.teammate : undefined,
          statement: statement === null ? null : Redacted.value(statement),
        }))
      )
    );

  return { teammate, store, dialled };
};

const PERSONAL = { issuer: "https://accounts.example", personId: "p-me" };

const WORK = { issuer: "https://accounts.corp.example", personId: "p-employee" };

test("Shares through two Accounts on one Host get a connection each, as that Account's person with its statement", async () => {
  const { teammate, dialled } = await twoAccounts([
    { ...entry("inv-1", "s1"), accountId: "personal" },
    { ...entry("inv-2", "s2"), accountId: "work" },
    { ...entry("inv-3", "s3"), accountId: "work" },
  ]);

  await Effect.runPromise(teammate.connectAll);
  const connections = await dialled();

  expect(connections.map((c) => [c.as, c.statement])).toEqual([
    [PERSONAL, "personal for mine"],
    [WORK, "work for mine"],
  ]);
  expect(new Set(connections.map((c) => c.key)).size).toBe(2);
});

test("accepting through a second Account on a Host already shared dials it as that Account and keeps both sessions apart", async () => {
  const { teammate, store, dialled } = await twoAccounts([
    { ...entry("inv-1", "s1"), accountId: "personal" },
  ]);

  // The same session, shared again with the work Account.
  const accepted = await Effect.runPromise(teammate.accept("work", "inv-2"));
  const [connection] = await dialled();

  expect(connection).toEqual({ key: accepted.hostKey, as: WORK, statement: "work for mine" });

  const kept = await Effect.runPromise(store.read);

  expect(kept.map((s) => [s.accountId, s.sessionId])).toEqual([
    ["personal", "s1"],
    ["work", "s1"],
  ]);

  const [personalKey, workKey] = kept.map(sharedHostKey);

  expect(workKey).toBe(accepted.hostKey);
  expect(personalKey).not.toBe(accepted.hostKey);
});
