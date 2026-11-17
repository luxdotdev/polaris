import { expect, test } from "bun:test";
import type { HostConnection } from "@polaris/client";
import { type AcceptedInvite, AccountsError, type AccountsApi } from "@polaris/client/accounts";
import { Effect, SubscriptionRef } from "effect";
import type { HostView } from "../../shared/api.ts";
import type { HostDirectory } from "../hosts.ts";
import { memorySharedStore, type SharedEntry, sharedHostKey } from "./store.ts";
import { hostsToCheck, teammateSharing, withMeView } from "./teammate.ts";

/** A fake of only what the code under test calls. */
// SAFETY: each test names the members its path reads; a call to any other would throw.
const only = <T>(part: Partial<T>): T => part as T;

const RELAY = "AAAAAAAAAAAAAAAAAAAAAA";

const KEY = sharedHostKey(RELAY);

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
