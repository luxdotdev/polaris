/** A Host's Shares and presence as the renderer shows them (`sharingContract.ts`). */
import {
  type Actor,
  isShareLive,
  type SharePresenceEntry,
  type ShareListing,
  type ShareLogEntry,
} from "@polaris/protocol";
import type { AccountRecord } from "@polaris/client/accounts";
import { Match, Predicate } from "effect";
import type {
  PresenceView,
  ShareLogView,
  ShareView,
  SharingPersonView,
} from "../../shared/sharingContract.ts";
import { type SharedEntry, sharedHostKey } from "./store.ts";

/** Looks up a person's avatar as a data URL, or null until it loads. */
export type AvatarOf = (login: string, url: string | null) => string | null;

/** The owner's own devices act as `Client`: on the owner's screen, that is "You". */
export const actorName = (actor: Actor | null): string | null =>
  actor === null
    ? null
    : Match.valueTags(actor, {
        Client: () => "You",
        Extension: (a) => a.name,
        LinkedDevice: (a) => a.name,
        Teammate: (a) => a.name,
      });

const logView = (entry: ShareLogEntry): ShareLogView => {
  const base = { at: entry.at, actor: actorName(entry.actor) };

  return Match.valueTags(entry, {
    Invited: (e): ShareLogView => ({ ...base, kind: "invited", detail: e.role }),
    Accepted: (): ShareLogView => ({ ...base, kind: "accepted", detail: null }),
    DeviceAdded: (e): ShareLogView => ({ ...base, kind: "device-added", detail: e.deviceName }),
    Renewed: (e): ShareLogView => ({ ...base, kind: "renewed", detail: e.expiresAt }),
    Granted: (e): ShareLogView => ({ ...base, kind: "granted", detail: e.role }),
    Revoked: (): ShareLogView => ({ ...base, kind: "revoked", detail: null }),
    Expired: (): ShareLogView => ({ ...base, kind: "expired", detail: null }),
  });
};

export const shareView = (listing: ShareListing, now: number, avatar: AvatarOf): ShareView => {
  const { share } = listing;

  const person: SharingPersonView = {
    login: share.person.login,
    name: share.person.name === "" ? null : share.person.name,
    avatar: avatar(share.person.login, share.person.avatarUrl),
  };

  return {
    id: share.id,
    person,
    role: share.role,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    revokedAt: share.revokedAt,
    live: isShareLive(share, now),
    log: listing.log.map(logView),
  };
};

/** Who is looking at a session's presence, and how its owner reads to them. */
export interface PresenceViewer {
  /** "You" on your own Host; the person who shared it on theirs. */
  readonly owner: SharingPersonView | null;
  /** The viewer's person on a Host shared with them; null on their own Host, where they own it. */
  readonly teammate: { readonly personId: string | null } | null;
}

/** The viewer of `sessionId` on `hostKey`: a Teammate when the session was shared with them. */
export const presenceViewer = (input: {
  readonly hostKey: string;
  readonly sessionId: string;
  readonly shared: ReadonlyArray<SharedEntry>;
  readonly accounts: ReadonlyArray<AccountRecord>;
  readonly avatar: AvatarOf;
}): PresenceViewer => {
  const entry = input.shared.find(
    (e) => sharedHostKey(e) === input.hostKey && e.sessionId === input.sessionId
  );

  if (entry !== undefined)
    return {
      owner: {
        login: entry.owner.login,
        name: entry.owner.name,
        avatar: input.avatar(entry.owner.login, entry.owner.avatarUrl),
      },
      teammate: {
        personId: input.accounts.find((a) => a.id === entry.accountId)?.personId ?? null,
      },
    };

  const account = input.accounts.find((a) => a.signedOutAt === null);

  return {
    owner:
      account === undefined
        ? null
        : {
            login: account.login,
            name: "You",
            avatar: input.avatar(account.login, account.avatarUrl),
          },
    teammate: null,
  };
};

/**
 * Who has the session open. A Teammate is named by their display name; the owner's own
 * devices fold into one entry: "You" on their screen, their name on a Teammate's.
 */
export const presenceViews = (
  entries: ReadonlyArray<SharePresenceEntry>,
  avatar: AvatarOf,
  viewer: PresenceViewer
): ReadonlyArray<PresenceView> => {
  const views: Array<PresenceView> = [];
  let ownerSeen = false;

  for (const entry of entries) {
    const actor = entry.actor;

    if (Predicate.isTagged(actor, "Teammate")) {
      views.push({
        key: `teammate:${actor.personId}`,
        person: {
          login: actor.name,
          name: actor.name,
          avatar: avatar(actor.name, entry.avatarUrl),
        },
        isOwner: false,
        self: viewer.teammate !== null && viewer.teammate.personId === actor.personId,
        since: entry.since,
      });
      continue;
    }

    if (ownerSeen) continue;
    ownerSeen = true;
    views.push({
      key: "owner",
      person: viewer.owner ?? { login: "you", name: "You", avatar: null },
      isOwner: true,
      self: viewer.teammate === null,
      since: entry.since,
    });
  }

  return views;
};
