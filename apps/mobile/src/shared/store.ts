/**
 * The Shares this person accepted on this iPhone, in the Keychain: where each owner's Host is,
 * what was shared, as which role, and the Account it came through. Nothing here is secret; the
 * statement that admits the device is fetched fresh for each connection.
 */
import { InviteHost, Person, SharedThing, ShareRole } from "@polaris/client/accounts";
import { POLARIS_CLOUD_RELAY_URL } from "@polaris/protocol";
import { Option, Schema } from "effect";
import type { Keychain } from "../accounts/store.ts";

/** The Invite's Host; `relayUrl` once Account Servers send it (B2), else Polaris Cloud's relay. */
export const SharedHostAddress = Schema.Struct({
  ...InviteHost.fields,
  relayUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

export type SharedHostAddress = typeof SharedHostAddress.Type;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The relay the owner's Host listens on: the Invite's, when it is wss:// (or ws:// on loopback),
 * else Polaris Cloud's. The Host's Noise key still pins it, so a wrong relay only fails to connect.
 */
export const relayUrlOf = (host: SharedHostAddress): string => {
  const named = host.relayUrl;

  if (named == null || !URL.canParse(named)) return POLARIS_CLOUD_RELAY_URL;
  const url = new URL(named);
  const ok = url.protocol === "wss:" || (url.protocol === "ws:" && LOOPBACK.has(url.hostname));

  return ok ? named : POLARIS_CLOUD_RELAY_URL;
};

export const AcceptedShare = Schema.Struct({
  /** This device's key for the Account the Invite came through. */
  accountId: Schema.String,
  /** That Account's person on its Account Server: who "You" is in the shared session. */
  personId: Schema.String,
  inviteId: Schema.String,
  host: SharedHostAddress,
  share: SharedThing,
  role: ShareRole,
  owner: Person,
});

export type AcceptedShare = typeof AcceptedShare.Type;

const KEY = "polaris.shared.accepted";

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(AcceptedShare)));

/** The key a shared Host's connection and its thread route go by: one per owner's Host and Account. */
export const sharedHostKey = (share: Pick<AcceptedShare, "accountId" | "host">) =>
  `shared:${share.accountId}:${share.host.noiseKey}`;

export interface SharedStore {
  readonly load: () => Promise<ReadonlyArray<AcceptedShare>>;
  /** Keeps `share`, replacing one accepted from the same Invite. */
  readonly add: (share: AcceptedShare) => Promise<ReadonlyArray<AcceptedShare>>;
  /** Forgets the Shares that came through an Account, as when it signs out. */
  readonly forgetAccount: (accountId: string) => Promise<ReadonlyArray<AcceptedShare>>;
}

export const sharedStore = (keychain: Keychain): SharedStore => {
  const load = async () => Option.getOrElse(decode((await keychain.get(KEY)) ?? ""), () => []);

  const save = async (shares: ReadonlyArray<AcceptedShare>) => {
    await keychain.set(KEY, JSON.stringify(shares));

    return shares;
  };

  return {
    load,
    add: async (share) =>
      save([...(await load()).filter((held) => held.inviteId !== share.inviteId), share]),
    forgetAccount: async (accountId) =>
      save((await load()).filter((held) => held.accountId !== accountId)),
  };
};
