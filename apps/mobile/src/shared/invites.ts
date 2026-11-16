/**
 * Shared with you on Home (DESIGN.md "Shared Sessions", SS4): unanswered Invites, then what
 * others shared, grouped by owner, each with its role and "Host offline" while unreachable.
 */
import type { AccountRecord, PendingInvite, Person } from "@polaris/client/accounts";
import { roleWord } from "./model.ts";
import { type AcceptedShare, sharedHostKey } from "./store.ts";

export const personName = (person: Person) => person.name ?? person.login;

export interface InviteRow {
  readonly key: string;
  readonly accountId: string;
  readonly invite: PendingInvite;
  /** "Lucas Doell" in "Lucas Doell shared *title* with you". */
  readonly owner: string;
  readonly title: string;
  /** "Contributor" or "Commenter". */
  readonly role: string;
  /** Who accepting credits: "Accepting credits your work here to maya@work.dev". */
  readonly credit: string;
  /** "@maya on Polaris Cloud": only when signed in to more than one Account. */
  readonly through: string | null;
}

/** The Account a Share came through, named only when there is more than one. */
const throughOf = (account: AccountRecord, accounts: ReadonlyArray<AccountRecord>) =>
  accounts.length > 1 ? `@${account.login}` : null;

export const inviteRows = (
  accounts: ReadonlyArray<AccountRecord>,
  invites: ReadonlyMap<string, ReadonlyArray<PendingInvite>>
): ReadonlyArray<InviteRow> =>
  accounts.flatMap((account) =>
    (invites.get(account.id) ?? []).map((invite) => ({
      key: `${account.id}:${invite.inviteId}`,
      accountId: account.id,
      invite,
      owner: personName(invite.owner),
      title: invite.share.title,
      role: roleWord(invite.role),
      credit: `Accepting credits your work here to ${account.commitEmail}`,
      through: throughOf(account, accounts),
    }))
  );

export interface SharedRow {
  /** The shared Host's connection key, which its thread route goes by. */
  readonly hostKey: string;
  readonly share: AcceptedShare;
  readonly title: string;
  readonly role: string;
  /** The owner's Host can't be reached: "Host offline", neutral. */
  readonly offline: boolean;
  /** Only sessions open on the phone; a Constellation says where it does. */
  readonly opens: boolean;
  readonly through: string | null;
}

export interface SharedGroup {
  readonly key: string;
  readonly owner: string;
  readonly rows: ReadonlyArray<SharedRow>;
}

export const sharedGroups = (
  shares: ReadonlyArray<AcceptedShare>,
  accounts: ReadonlyArray<AccountRecord>,
  offline: (hostKey: string) => boolean
): ReadonlyArray<SharedGroup> => {
  const groups = new Map<string, Array<SharedRow>>();
  const owners = new Map<string, string>();

  for (const share of shares) {
    const account = accounts.find((held) => held.id === share.accountId);

    // A signed-out Account's Shares can't be reached: Settings shows it signed out.
    if (account === undefined || account.signedOutAt !== null) continue;
    const key = `${account.server}\u0000${share.owner.personId}`;
    const hostKey = sharedHostKey(share);
    owners.set(key, personName(share.owner));
    groups.set(key, [
      ...(groups.get(key) ?? []),
      {
        hostKey,
        share,
        title: share.share.title,
        role: roleWord(share.role),
        offline: offline(hostKey),
        opens: share.share.kind === "session",
        through: throughOf(account, accounts),
      },
    ]);
  }

  return [...groups]
    .map(([key, rows]) => ({ key, owner: owners.get(key) ?? "", rows }))
    .sort((a, b) => a.owner.localeCompare(b.owner));
};
