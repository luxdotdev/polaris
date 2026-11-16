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
      const hostKey = sharedHostKey(entry.host.relayAddress);
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
        hostOffline: offline(view),
        ended: ended(view),
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

  /** One relay Host per owner's Host, connecting as the Account its first session came through. */
  const hostEntry = (entry: SharedEntry): HostEntry | null => {
    const address = relayAddress(entry.host.relayAddress);

    if (Option.isNone(address)) return null;

    return {
      key: sharedHostKey(entry.host.relayAddress),
      label: entry.host.name,
      colour: null,
      alias: null,
      proofHarness: false,
      target: HostTarget.Relay({
        relayUrl: entry.host.relayUrl ?? input.defaultRelayUrl,
        hostAddress: address.value,
        hostNoiseKey: entry.host.noiseKey,
      }),
      remoteCommand: null,
      simulatedLatencyMs: null,
      teammate: { accountId: entry.accountId, accountStatement: statement(entry.accountId) },
    };
  };

  const connectAll = Effect.gen(function* () {
    const seen = new Set<string>();

    for (const entry of yield* SubscriptionRef.get(shared)) {
      const host = hostEntry(entry);

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
    // SAFETY: B2 adds the optional relayUrl to InviteHost; an older Account Server omits it.
    const host = accepted.host as typeof accepted.host & { readonly relayUrl?: string };

    const entry: SharedEntry = {
      accountId,
      inviteId,
      owner: {
        login: accepted.owner.login,
        name: accepted.owner.name,
        avatarUrl: accepted.owner.avatarUrl,
      },
      host: sharedHost(host),
      sessionId: accepted.share.id,
      title: accepted.share.title,
      role: accepted.role,
      acceptedAt: input.now(),
    };

    const next = yield* SubscriptionRef.updateAndGet(shared, (before) => [
      ...before.filter((s) => !(s.sessionId === entry.sessionId && sameHost(s, entry))),
      entry,
    ]);

    yield* store.write(next);
    const added = hostEntry(entry);

    // A Host already connected stays so; its host feed follows `shared`.
    if (added !== null) yield* hosts.add(added);

    return { hostKey: sharedHostKey(entry.host.relayAddress), sessionId: entry.sessionId };
  });

  return {
    connectAll,
    fetchInvites,
    accept,
    decline: (accountId: string, inviteId: string) => accounts.decline(accountId, inviteId),
    /** The sessions shared through the Host with this key now and on every change. */
    sessionsOn: (hostKey: string) =>
      SubscriptionRef.changes(shared).pipe(
        Stream.map((all) =>
          all
            .filter((s) => sharedHostKey(s.host.relayAddress) === hostKey)
            .map((s) => SessionId.make(s.sessionId))
        ),
        Stream.changesWith((a, b) => a.join() === b.join())
      ),
  };
};

const sharedHost = (host: {
  readonly name: string;
  readonly relayAddress: string;
  readonly noiseKey: string;
  readonly relayUrl?: string;
}): SharedEntry["host"] => {
  const kept = { name: host.name, relayAddress: host.relayAddress, noiseKey: host.noiseKey };

  if (host.relayUrl === undefined) return kept;

  return { ...kept, relayUrl: host.relayUrl };
};

const sameHost = (a: SharedEntry, b: SharedEntry) => a.host.relayAddress === b.host.relayAddress;

export type TeammateSharing = ReturnType<typeof teammateSharing>;
