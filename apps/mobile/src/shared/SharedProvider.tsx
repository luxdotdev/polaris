/**
 * Sessions shared with this person (ADR 0112) as React state: the Invites waiting on each signed-in
 * Account, the Shares accepted on this iPhone, and a Teammate's connection to each owner's Host
 * through the Polaris Relay, admitted by a fresh statement from the Account Server.
 */
import type { AccountRecord, PendingInvite } from "@polaris/client/accounts";
import { devicePublicKeys, type RelayDevice } from "@polaris/client/relay";
import { TransportError } from "@polaris/protocol";
import { RelayAddress } from "@polaris/protocol/relay";
import { Effect, Option, Schema } from "effect";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { type PolarisAccounts, usePolarisAccounts } from "../accounts/AccountsProvider.tsx";
import { secureStoreKeychain } from "../accounts/keychain.ts";
import { useRelay } from "../relay/RelayProvider.tsx";
import type { HostTransport } from "../runtime/hostConnection.ts";
import { useHostRegistry } from "../runtime/hosts.tsx";
import type { InviteRow } from "./invites.ts";
import { personName } from "./invites.ts";
import { type AcceptedShare, relayUrlOf, sharedHostKey, sharedStore } from "./store.ts";

export interface Shared {
  /** False until the Keychain was read. */
  readonly loaded: boolean;
  readonly accepted: ReadonlyArray<AcceptedShare>;
  /** Signed-in Accounts, which Invites and Shares come through. */
  readonly accounts: ReadonlyArray<AccountRecord>;
  /** Unanswered Invites by Account id. */
  readonly invites: ReadonlyMap<string, ReadonlyArray<PendingInvite>>;
  /** Asks each Account's server for its Invites again (Home's pull to refresh). */
  readonly refresh: () => Promise<void>;
  /** Accepts on the Account Server and connects; resolves with the shared Host's key, or why not. */
  readonly accept: (
    row: InviteRow
  ) => Promise<{ readonly hostKey: string } | { readonly failure: string }>;
  /** Resolves with why it failed, or null. */
  readonly decline: (row: InviteRow) => Promise<string | null>;
}

const SharedContext = createContext<Shared | null>(null);

const store = sharedStore(secureStoreKeychain);

const decodeAddress = Schema.decodeUnknownOption(RelayAddress);

const relayTransport = (
  device: () => Promise<RelayDevice>,
  share: AcceptedShare
): HostTransport => ({
  route: "relay",
  open: Effect.gen(function* () {
    const address = Option.getOrNull(decodeAddress(share.host.relayAddress));

    if (address === null)
      return yield* new TransportError({ message: "the invite's relay address is malformed" });

    const relay = yield* Effect.tryPromise({
      try: device,
      catch: () => new TransportError({ message: "this iPhone's relay keys couldn't be read" }),
    });

    return yield* relay.transport({
      relayUrl: relayUrlOf(share.host),
      hostAddress: address,
      hostNoiseKey: share.host.noiseKey,
    });
  }),
});

/** Each signed-in Account's unanswered Invites; one whose server didn't answer has none. */
const invitesOf = async (
  accounts: ReadonlyArray<AccountRecord>,
  call: PolarisAccounts["call"]
): Promise<ReadonlyMap<string, ReadonlyArray<PendingInvite>>> =>
  new Map(
    await Promise.all(
      accounts.map(async (account) => {
        const outcome = await call((a) => a.invites(account.id));

        return [account.id, outcome.ok ? outcome.value : []] as const;
      })
    )
  );

/** One connection per owner's Host and Account, the first Share naming it giving its link. */
const byHost = (shares: ReadonlyArray<AcceptedShare>) => {
  const hosts = new Map<string, AcceptedShare>();

  for (const share of shares)
    if (!hosts.has(sharedHostKey(share))) hosts.set(sharedHostKey(share), share);

  return hosts;
};

export const SharedProvider = ({ children }: { readonly children: ReactNode }) => {
  const accounts = usePolarisAccounts();
  const relay = useRelay();
  const registry = useHostRegistry();

  const [loaded, setLoaded] = useState(false);
  const [accepted, setAccepted] = useState<ReadonlyArray<AcceptedShare>>([]);

  const [invites, setInvites] = useState<ReadonlyMap<string, ReadonlyArray<PendingInvite>>>(
    new Map()
  );

  const signedIn = useMemo(
    () => (accounts.state?.accounts ?? []).filter((account) => account.signedOutAt === null),
    [accounts.state?.accounts]
  );

  const { call } = accounts;
  const { device } = relay;

  useEffect(() => {
    void store.load().then((held) => {
      setAccepted(held);
      setLoaded(true);
    });
  }, []);

  // A Teammate's connection for each owner's Host reached through a signed-in Account.
  const linked = useMemo(
    () => byHost(accepted.filter((share) => signedIn.some((a) => a.id === share.accountId))),
    [accepted, signedIn]
  );

  const { shared: sharedHosts, addHost, removeHost } = registry;

  useEffect(() => {
    const open = sharedHosts.map((connection) => connection.hostId);

    for (const key of open) if (!linked.has(key)) removeHost(key);

    for (const [key, share] of linked) {
      if (open.includes(key)) continue;

      const statement = async () => {
        const keys = devicePublicKeys((await device()).keys);
        const outcome = await call((a) => a.statementFor(share.accountId, keys.noiseKey));

        if (!outcome.ok) throw new Error(outcome.message);

        return outcome.value;
      };

      addHost(key, share.host.name, relayTransport(device, share), {
        accountStatement: statement,
        teammate: {
          personId: share.personId,
          role: share.role,
          ownerName: personName(share.owner),
        },
      });
    }
  }, [linked, device, call, sharedHosts, addHost, removeHost]);

  const refresh = useCallback(async () => {
    setInvites(await invitesOf(signedIn, call));
  }, [signedIn, call]);

  useEffect(() => {
    let gone = false;

    void invitesOf(signedIn, call).then((found) => {
      if (!gone) setInvites(found);
    });

    return () => {
      gone = true;
    };
  }, [signedIn, call]);

  const accept = useCallback(
    async (row: InviteRow) => {
      const account = signedIn.find((held) => held.id === row.accountId);

      if (account === undefined) return { failure: "That Polaris account is signed out" };
      const keys = devicePublicKeys((await device()).keys);

      const outcome = await call((a) =>
        a.accept(account.id, row.invite.inviteId, {
          relayAddress: keys.relayAddress,
          noiseKey: keys.noiseKey,
        })
      );

      if (!outcome.ok) return { failure: outcome.message };

      const share: AcceptedShare = {
        accountId: account.id,
        personId: account.personId,
        inviteId: row.invite.inviteId,
        host: outcome.value.host,
        share: outcome.value.share,
        role: outcome.value.role,
        owner: outcome.value.owner,
      };

      setAccepted(await store.add(share));
      void refresh();

      return { hostKey: sharedHostKey(share) };
    },
    [signedIn, call, device, refresh]
  );

  const decline = useCallback(
    async (row: InviteRow) => {
      const outcome = await call((a) => a.decline(row.accountId, row.invite.inviteId));
      void refresh();

      return outcome.ok ? null : outcome.message;
    },
    [call, refresh]
  );

  const value = useMemo<Shared>(
    () => ({ loaded, accepted, accounts: signedIn, invites, refresh, accept, decline }),
    [loaded, accepted, signedIn, invites, refresh, accept, decline]
  );

  return <SharedContext.Provider value={value}>{children}</SharedContext.Provider>;
};

/** Nothing shared: development galleries draw Home and threads without the provider. */
const NOTHING: Shared = {
  loaded: true,
  accepted: [],
  accounts: [],
  invites: new Map(),
  refresh: () => Promise.resolve(),
  accept: () => Promise.resolve({ failure: "Sharing isn't available here" }),
  decline: () => Promise.resolve(null),
};

export const useShared = (): Shared => useContext(SharedContext) ?? NOTHING;
