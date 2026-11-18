/**
 * The Teammate's side of sharing: Invites waiting on each signed-in Polaris account, accepting
 * one with this device's relay keys, and a relay connection to each owner's Host that presents
 * the Account's statement (ADR 0112). What was accepted is kept in `store.ts`.
 */
import { ConnectFailure, HostTarget } from "@polaris/client";
import type { AccountRecord, AccountsApi, PendingInvite } from "@polaris/client/accounts";
import { SessionId } from "@polaris/protocol";
import { RelayAddress } from "@polaris/protocol/relay";
import { Effect, Option, Redacted, Schema, Stream, SubscriptionRef } from "effect";
import type { HostView } from "../../shared/api.ts";
import type {
  InviteView,
  SharedSessionView,
  SharedWithMeView,
} from "../../shared/sharingContract.ts";
import type { HostDirectory, HostEntry } from "../hosts.ts";
import type { RelayDeviceUnavailable } from "../relayDevice.ts";
import { type SharedEntry, type SharedStore, sharedHostKey } from "./store.ts";
import type { AvatarOf } from "./views.ts";

export interface DeviceKeys {
  readonly relayAddress: string;
  readonly noiseKey: string;
}

export interface TeammateInput {
  readonly hosts: HostDirectory["Service"];
  readonly accounts: AccountsApi;
  readonly store: SharedStore;
  /** What was accepted, as kept in `store`; the host feeds follow it. */
  readonly shared: SubscriptionRef.SubscriptionRef<ReadonlyArray<SharedEntry>>;
  readonly deviceKeys: Effect.Effect<DeviceKeys, RelayDeviceUnavailable>;
  /** Dialled for an Invite that names no relay. */
  readonly defaultRelayUrl: string;
  readonly avatar: AvatarOf;
  readonly now: () => number;
}

/** Invites as each Account's server last answered, by Account id. */
export type InvitesByAccount = ReadonlyMap<string, ReadonlyArray<PendingInvite>>;

const signedIn = (accounts: ReadonlyArray<AccountRecord>) =>
  accounts.filter((a) => a.signedOutAt === null);

const unreachable = new Set(["offline", "reconnecting", "needs-attention"]);

/** The owner's Host is out of reach; a Share that ended is not "offline". */
const offline = (view: HostView | undefined) =>
  view !== undefined &&
  unreachable.has(view.status.state) &&
  view.status.failure?.reason !== "share-ended";

const ended = (view: HostView | undefined) => view?.status.failure?.reason === "share-ended";

/** The Account Server's answers that mean an accepted Invite no longer stands. */
const CLOSED = new Set(["InviteClosed", "InviteNotFound"]);

/**
 * The shared Hosts worth asking the Account Server about: out of reach, with a Share not yet
 * known to have ended. A revoked device gets no answer from the Host, as an offline Host gives.
 */
export const hostsToCheck = (
  shared: ReadonlyArray<SharedEntry>,
  hosts: ReadonlyArray<HostView>
): ReadonlyArray<{ readonly hostKey: string; readonly attempt: string }> =>
  hosts.flatMap((view) =>
    offline(view) && shared.some((s) => s.endedAt === undefined && sharedHostKey(s) === view.key)
      ? [{ hostKey: view.key, attempt: `${view.status.since}/${view.status.attempt}` }]
      : []
  );

/** The sidebar's view: Invites not yet accepted here, then what was, newest first. */
export const withMeView = (input: {
  readonly accounts: ReadonlyArray<AccountRecord>;
  readonly invites: InvitesByAccount;
  readonly shared: ReadonlyArray<SharedEntry>;
  readonly hosts: ReadonlyArray<HostView>;
  readonly avatar: AvatarOf;
}): SharedWithMeView => {
  const live = signedIn(input.accounts);
  const accepted = new Set(input.shared.map((s) => s.inviteId));

  const invites: Array<InviteView> = live.flatMap((account) =>
    (input.invites.get(account.id) ?? [])
      .filter((invite) => !accepted.has(invite.inviteId))
      .map((invite) => ({
        accountId: account.id,
        inviteId: invite.inviteId,
        owner: {
          login: invite.owner.login,
          name: invite.owner.name,
          avatar: input.avatar(invite.owner.login, invite.owner.avatarUrl),
        },
        title: invite.share.title,
        hostName: invite.host.name,
        role: invite.role,
        expiresAt: invite.expiresAt,
        commitEmail: account.commitEmail,
      }))
  );

  const sessions: Array<SharedSessionView> = [...input.shared]
    .toSorted((a, b) => b.acceptedAt - a.acceptedAt)
    .map((entry) => {
      const hostKey = sharedHostKey(entry);
      const view = input.hosts.find((h) => h.key === hostKey);

      return {
        accountId: entry.accountId,
        hostKey,
        sessionId: entry.sessionId,
        title: entry.title,
        owner: {
          login: entry.owner.login,
          name: entry.owner.name,
          avatar: input.avatar(entry.owner.login, entry.owner.avatarUrl),
        },
        hostName: entry.host.name,
        role: entry.role,
        selfPersonId: input.accounts.find((a) => a.id === entry.accountId)?.personId ?? null,
        hostOffline: entry.endedAt === undefined && offline(view),
        ended: entry.endedAt !== undefined || ended(view),
      };
    });

  return { invites, sessions, accounts: live.map((a) => ({ id: a.id, login: a.login })) };
};

const relayAddress = Schema.decodeUnknownOption(RelayAddress);

export const teammateSharing = (input: TeammateInput) => {
  const { hosts, accounts, store, shared } = input;

  const statement = (accountId: string) =>
    Effect.gen(function* () {
      const keys = yield* input.deviceKeys;

      return Redacted.make(yield* accounts.statementFor(accountId, keys.noiseKey));
    }).pipe(
      Effect.mapError(
        (error) =>
          new ConnectFailure({
            kind: "transient",
            reason: "connection-failed",
            detail: error.message,
          })
      )
    );

  /**
   * One relay Host per owner's Host and Account: the connection names that Account's person in
   * its handshake and presents that Account's statement. Null for an Account no longer here.
   */
  const hostEntry = (entry: SharedEntry, held: ReadonlyArray<AccountRecord>): HostEntry | null => {
    const address = relayAddress(entry.host.relayAddress);
    const relayUrl = entry.host.relayUrl ?? input.defaultRelayUrl;
    const account = held.find((a) => a.id === entry.accountId);

    if (Option.isNone(address) || !isRelayUrl(relayUrl) || account === undefined) return null;

    return {
      key: sharedHostKey(entry),
      label: entry.host.name,
      colour: null,
      alias: null,
      proofHarness: false,
      target: HostTarget.Relay({
        relayUrl,
        hostAddress: address.value,
        hostNoiseKey: entry.host.noiseKey,
        teammate: { issuer: account.server, personId: account.personId },
      }),
      remoteCommand: null,
      simulatedLatencyMs: null,
      teammate: { accountId: entry.accountId, accountStatement: statement(entry.accountId) },
    };
  };

  const connectAll = Effect.gen(function* () {
    const seen = new Set<string>();
    const held = yield* accounts.list;

    for (const entry of yield* SubscriptionRef.get(shared)) {
      const host = entry.endedAt === undefined ? hostEntry(entry, held) : null;

      if (host === null || seen.has(host.key)) continue;
      seen.add(host.key);
      yield* hosts.add(host);
    }
  });

  /** Every signed-in Account's waiting Invites; an Account whose server fails keeps none. */
  const fetchInvites = Effect.gen(function* () {
    const live = signedIn(yield* accounts.list);

    const answers = yield* Effect.forEach(
      live,
      (account) =>
        Effect.map(
          Effect.orElseSucceed(
            accounts.invites(account.id),
            (): ReadonlyArray<PendingInvite> => []
          ),
          (invites) => [account.id, invites] as const
        ),
      { concurrency: 4 }
    );

    const byAccount: InvitesByAccount = new Map(answers);

    return byAccount;
  });

  const accept = Effect.fn("Sharing.accept")(function* (accountId: string, inviteId: string) {
    const keys = yield* input.deviceKeys;
    const accepted = yield* accounts.accept(accountId, inviteId, keys);

    const entry: SharedEntry = {
      accountId,
      inviteId,
      owner: {
        login: accepted.owner.login,
        name: accepted.owner.name,
        avatarUrl: accepted.owner.avatarUrl,
      },
      host: sharedHost(accepted.host),
      sessionId: accepted.share.id,
      title: accepted.share.title,
      role: accepted.role,
      acceptedAt: input.now(),
    };

    const before = yield* SubscriptionRef.get(shared);
    const known = before.find((s) => sameHost(s, entry));
    const key = sharedHostKey(entry);
    const added = hostEntry(entry, yield* accounts.list);

    if (added === null || (known !== undefined && !sameKeys(known, entry)))
      return yield* new InviteRefused({
        message: "This invite names a host Polaris can't reach safely.",
      });

    const next = yield* SubscriptionRef.updateAndGet(shared, (held) => [
      ...held.filter((s) => !(s.sessionId === entry.sessionId && sharedHostKey(s) === key)),
      entry,
    ]);

    yield* store.write(next);

    // A Host already connected as this Account stays so; its host feed follows `shared`.
    yield* hosts.add(added);

    // A Host that was refusing this Account (its last Share ended) is dialled again at once.
    if (before.some((s) => sharedHostKey(s) === key && s.endedAt !== undefined))
      yield* Effect.ignore(Effect.flatMap(hosts.connection(key), (c) => c.retryNow));

    return { hostKey: key, sessionId: entry.sessionId };
  });

  /** Whether the Account Server still holds this accepted Invite; unknown counts as standing. */
  const stands = (entry: SharedEntry) =>
    Effect.gen(function* () {
      const keys = yield* input.deviceKeys;

      yield* accounts.accept(entry.accountId, entry.inviteId, keys);

      return true;
    }).pipe(
      Effect.catchTag("AccountsError", (error) =>
        Effect.succeed(!CLOSED.has(error.serverTag ?? ""))
      ),
      Effect.orElseSucceed(() => true)
    );

  /**
   * Asks the Account Server about the Shares on a Host that stopped answering and marks the
   * ones that ended. The Host stays dialled, so a new Share from it resumes the same feed.
   */
  const checkStanding = Effect.fn("Sharing.checkStanding")(function* (hostKey: string) {
    const on = (s: SharedEntry) => sharedHostKey(s) === hostKey;

    const open = (yield* SubscriptionRef.get(shared)).filter(
      (s) => on(s) && s.endedAt === undefined
    );

    const closed = new Set<string>();

    for (const entry of open) if (!(yield* stands(entry))) closed.add(entry.inviteId);

    if (closed.size === 0) return;
    const endedAt = input.now();

    const next = yield* SubscriptionRef.updateAndGet(shared, (before) =>
      before.map((s) => (closed.has(s.inviteId) ? { ...s, endedAt } : s))
    );

    yield* store.write(next);
  });

  return {
    connectAll,
    fetchInvites,
    accept,
    checkStanding,
    decline: (accountId: string, inviteId: string) => accounts.decline(accountId, inviteId),
    /** The sessions shared through the Host with this key now and on every change. */
    sessionsOn: (hostKey: string) =>
      SubscriptionRef.changes(shared).pipe(
        Stream.map((all) =>
          all.filter((s) => sharedHostKey(s) === hostKey).map((s) => SessionId.make(s.sessionId))
        ),
        Stream.changesWith((a, b) => a.join() === b.join())
      ),
  };
};

const sharedHost = (host: {
  readonly name: string;
  readonly relayAddress: string;
  readonly noiseKey: string;
  readonly relayUrl: string | null;
}): SharedEntry["host"] => {
  const kept = { name: host.name, relayAddress: host.relayAddress, noiseKey: host.noiseKey };

  // A null relay is Polaris Cloud: kept absent, as the store and sameKeys read it.
  if (host.relayUrl === null) return kept;

  return { ...kept, relayUrl: host.relayUrl };
};

const sameHost = (a: SharedEntry, b: SharedEntry) => a.host.relayAddress === b.host.relayAddress;

/** A relay address seen before must keep its Noise key, relay and owner. */
const sameKeys = (a: SharedEntry, b: SharedEntry) =>
  a.host.noiseKey === b.host.noiseKey &&
  a.host.relayUrl === b.host.relayUrl &&
  a.owner.login === b.owner.login;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** wss anywhere; plain ws only to this machine (a local relay in tests and development). */
export const isRelayUrl = (url: string): boolean => {
  if (!URL.canParse(url)) return false;
  const parsed = new URL(url);

  return parsed.protocol === "wss:" || (parsed.protocol === "ws:" && LOOPBACK.has(parsed.hostname));
};

/** An accepted Invite whose Host can't be dialled safely, or that contradicts one seen before. */
export class InviteRefused extends Schema.TaggedError<InviteRefused>()("InviteRefused", {
  message: Schema.String,
}) {}

export type TeammateSharing = ReturnType<typeof teammateSharing>;
