/**
 * The words sharing shows (DESIGN.md, Shared Sessions; Paper SS1–SS4): roles, expiries, the share
 * log, the share sheet's refusals and the sidebar's owner groups. Pure, so it is unit-tested.
 */
import type { ShareRole } from "@polaris/protocol";
import type { IpcError } from "../../../../shared/api.ts";
import type {
  ShareLogView,
  SharedSessionView,
  ShareView,
  SharingPersonView,
} from "../../../../shared/sharingContract.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;

export const roleLabel = (role: ShareRole): string =>
  role === "contributor" ? "Contributor" : "Commenter";

/** "Alex Rivera", or "@alex" when the Account Server has no name for them. */
export const personName = (person: SharingPersonView): string => person.name ?? `@${person.login}`;

/** The first name, for the sheet's plain statements ("Alex will see everything…"). */
export const firstName = (person: SharingPersonView): string =>
  person.name?.split(/\s+/)[0] ?? `@${person.login}`;

/** Two letters for an avatar until its image loads: the name's initials, else the login's. */
export const initialsOf = (person: SharingPersonView): string => {
  const words = (person.name ?? "").split(/\s+/).filter((w) => w.length > 0);

  if (words.length >= 2) return `${words[0]?.[0] ?? ""}${words.at(-1)?.[0] ?? ""}`.toUpperCase();

  return (words[0] ?? person.login)
    .replaceAll(/[^a-z0-9]/gi, "")
    .slice(0, 2)
    .toUpperCase();
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const shortDate = (at: number) =>
  new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** "in 6 days", "in 5 hours", or "in under an hour". */
const until = (at: number, now: number) => {
  const left = at - now;

  if (left >= DAY_MS) return `in ${plural(Math.round(left / DAY_MS), "day")}`;

  return left >= HOUR_MS ? `in ${plural(Math.round(left / HOUR_MS), "hour")}` : "in under an hour";
};

/** A Share's second line: its role, then when it ends or how it ended. */
export const shareLine = (share: ShareView, now: number): string => {
  const role = roleLabel(share.role);

  if (share.revokedAt !== null)
    return `${role} · revoked ${shortDate(Date.parse(share.revokedAt))}`;
  const expires = Date.parse(share.expiresAt);

  if (expires <= now) return `${role} · expired ${shortDate(expires)}`;

  const joined = share.log.some((e) => e.kind === "accepted");

  return joined
    ? `${role} · expires ${until(expires, now)}`
    : `Invited as ${role} · not accepted yet · lapses ${shortDate(expires)}`;
};

/** The sheet's expiry choices, in days; 7 is the default and 30 the most a Share may last. */
export const EXPIRY_DAYS = [1, 7, 14, 30] as const;

export type ExpiryDays = (typeof EXPIRY_DAYS)[number];

export const DEFAULT_EXPIRY_DAYS: ExpiryDays = 7;

/** "Nov 23 · renewable, up to 30 days" beside the expiry choice. */
export const expiryNote = (days: ExpiryDays, now: number): string =>
  `${shortDate(now + days * DAY_MS)} · renewable, up to 30 days`;

/** What `sharing.share` sends for the choice: null takes the Host's default (7 days). */
export const expiresAtFor = (days: ExpiryDays, now: number): string | null =>
  days === DEFAULT_EXPIRY_DAYS ? null : new Date(now + days * DAY_MS).toISOString();

/** The login without its "@", as the sheet's field may hold it. */
export const bareLogin = (text: string): string => text.trim().replace(/^@/, "");

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export const isLogin = (text: string): boolean => LOGIN.test(bareLogin(text));

/** The sheet's line for a refused share; null when there is nothing to say. */
export const shareRefusal = (
  error: IpcError,
  login: string,
  serverLabel: string
): string | null => {
  const who = `@${bareLogin(login)}`;

  // SHARING_ERRORS in sharingContract.ts: PersonNotFound and SignedOut.
  if (error.code === "PersonNotFound")
    return `${who} hasn't signed in to Polaris on ${serverLabel}, so they can't be invited from this account yet.`;

  if (error.code === "SignedOut")
    return `This Polaris account was signed out on ${serverLabel}. Sign in again in Settings → Polaris accounts.`;

  return error.message === "" ? `Couldn't share with ${who}.` : error.message;
};

const roleOrDetail = (detail: string | null) =>
  detail === "contributor" || detail === "commenter" ? roleLabel(detail) : detail;

/** One share log line: who did what, to whom; the Host's own entries name no actor. */
export const logLine = (entry: ShareLogView, person: string): string => {
  const who = entry.actor ?? "Polaris";
  const detail = roleOrDetail(entry.detail);

  switch (entry.kind) {
    case "invited":
      return `${who} invited ${person}${detail === null ? "" : ` as ${detail}`}`;
    case "accepted":
      return `${person} joined`;
    case "device-added":
      return `New device for ${person}${detail === null ? "" : `: ${detail}`}`;
    case "renewed":
      return `${who} renewed ${person}${detail === null ? "" : ` until ${detail}`}`;
    case "granted":
      return `${who} granted ${person}${detail === null ? "" : ` ${detail}`}`;
    case "revoked":
      return `${who} revoked ${person}`;
    case "expired":
      return `${person}'s share expired`;
  }
};

/** "2:41 PM" today, else "Nov 14". */
export const logTime = (at: string, now: number): string => {
  const time = Date.parse(at);
  const sameDay = new Date(time).toDateString() === new Date(now).toDateString();

  return sameDay
    ? new Date(time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : shortDate(time);
};

export interface ShareLogRow {
  readonly key: string;
  readonly at: string;
  readonly line: string;
}

/** Every Share's log in one list, newest first. */
export const shareLog = (shares: ReadonlyArray<ShareView>): ReadonlyArray<ShareLogRow> =>
  shares
    .flatMap((share) =>
      share.log.map((entry, i) => ({
        key: `${share.id}:${i}`,
        at: entry.at,
        line: logLine(entry, personName(share.person)),
      }))
    )
    .toSorted((a, b) => b.at.localeCompare(a.at));

export interface OwnerGroup {
  readonly key: string;
  readonly owner: SharingPersonView;
  /** The Account the sessions came through, shown only with more than one signed in. */
  readonly via: string | null;
  readonly sessions: ReadonlyArray<SharedSessionView>;
}

/** Shared with you, grouped by owner (and the Account it came through), in first-seen order. */
export const ownerGroups = (
  sessions: ReadonlyArray<SharedSessionView>,
  accounts: ReadonlyArray<{ readonly id: string; readonly login: string }>
): ReadonlyArray<OwnerGroup> => {
  const groups = new Map<string, OwnerGroup>();

  for (const session of sessions) {
    const key = `${session.accountId}\u0000${session.owner.login}`;
    const group = groups.get(key);

    const via =
      accounts.length > 1 ? (accounts.find((a) => a.id === session.accountId) ?? null) : null;

    groups.set(key, {
      key,
      owner: session.owner,
      via: via === null ? null : `@${via.login}`,
      sessions: [...(group?.sessions ?? []), session],
    });
  }

  return [...groups.values()];
};

/** A shared session's second line: your role, then "Host offline" when it can't be reached. */
export const sharedLine = (session: SharedSessionView, state: string | null): string => {
  const role = roleLabel(session.role);

  if (session.ended) return `${role} · Share ended`;

  if (session.hostOffline) return `${role} · Host offline`;

  return state === null ? role : `${role} · ${state}`;
};
