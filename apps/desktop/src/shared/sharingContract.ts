/**
 * The `sharing.*` IPC (ENG-941, ADR 0112): an owner's Shares of a session, who has it open, and
 * a Teammate's Invites and the sessions shared with them. The main process holds every token
 * and Host capability; avatars arrive as data URLs (the CSP blocks remote images).
 */
import { SessionId, ShareId, ShareRole, Timestamp } from "@polaris/protocol";
import { Schema } from "effect";

const HostKey = Schema.String.check(Schema.isMinLength(1));

const AccountId = Schema.String.check(Schema.isPattern(/^[a-z0-9]{1,64}$/));

/** A GitHub login as the share sheet takes it, with or without the "@". */
const Login = Schema.String.check(Schema.isPattern(/^@?[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/));

const OnSession = { hostKey: HostKey, sessionId: SessionId };

export const SharingRequestInputs = {
  /** Invites `login` on the Account's server, then records the Share on the session's Host. */
  "sharing.share": Schema.Struct({
    ...OnSession,
    /** The session's Workspace, which takes this Account as its sharing Account if it has none. */
    workspaceId: Schema.String,
    /** The session's title, which the Invite shows the invitee. */
    title: Schema.String,
    accountId: AccountId,
    login: Login,
    role: ShareRole,
    /** Null takes the default (7 days). */
    expiresAt: Schema.NullOr(Timestamp),
  }),
  /** The session's Shares with their logs, newest first; ended ones included. */
  "sharing.list": Schema.Struct(OnSession),
  /** The sessions on a Host with a live Share, for the people glyph in their rows. */
  "sharing.sharedSessions": Schema.Struct({ hostKey: HostKey }),
  "sharing.renew": Schema.Struct({
    hostKey: HostKey,
    shareId: ShareId,
    expiresAt: Schema.NullOr(Timestamp),
  }),
  "sharing.revoke": Schema.Struct({ hostKey: HostKey, shareId: ShareId }),
  /** Accepts with this device's relay keys, then connects to the owner's Host through the relay. */
  "sharing.invite.accept": Schema.Struct({ accountId: AccountId, inviteId: Schema.String }),
  "sharing.invite.decline": Schema.Struct({ accountId: AccountId, inviteId: Schema.String }),
  /** Asks every signed-in Account's server for Invites now. */
  "sharing.invites.refresh": Schema.Struct({}),
} as const;

export type SharingMethod = keyof typeof SharingRequestInputs;

export interface SharingPersonView {
  readonly login: string;
  readonly name: string | null;
  /** A data URL fetched by the main process; null until then, or for no avatar (initials). */
  readonly avatar: string | null;
}

export type ShareLogKind =
  | "invited"
  | "accepted"
  | "device-added"
  | "renewed"
  | "granted"
  | "revoked"
  | "expired";

export interface ShareLogView {
  readonly kind: ShareLogKind;
  readonly at: string;
  /** Who did it, as a name ("You", "@octocat", "Raycast"); null when the Host did. */
  readonly actor: string | null;
  /** The role or expiry an entry set, or a new device's name. */
  readonly detail: string | null;
}

export interface ShareView {
  readonly id: string;
  readonly person: SharingPersonView;
  readonly role: ShareRole;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  /** Neither revoked nor expired. */
  readonly live: boolean;
  /** Oldest first. */
  readonly log: ReadonlyArray<ShareLogView>;
}

export interface PresenceView {
  readonly key: string;
  readonly person: SharingPersonView;
  /** The owner on one of their own devices. */
  readonly isOwner: boolean;
  /** Whoever is looking: the owner on their own Host, the Teammate on someone else's. */
  readonly self: boolean;
  readonly since: string;
}

export interface InviteView {
  readonly accountId: string;
  readonly inviteId: string;
  readonly owner: SharingPersonView;
  readonly title: string;
  readonly hostName: string;
  readonly role: ShareRole;
  readonly expiresAt: string;
  /** The address that will credit you, from the Account it came through. */
  readonly commitEmail: string;
}

export interface SharedSessionView {
  readonly accountId: string;
  readonly hostKey: string;
  readonly sessionId: string;
  readonly title: string;
  readonly owner: SharingPersonView;
  readonly hostName: string;
  readonly role: ShareRole;
  /** Your person on the Account it came through, as the Host names your Turns; null signed out. */
  readonly selfPersonId: string | null;
  /** The owner's Host can't be reached; the transcript is the cached one. */
  readonly hostOffline: boolean;
  /** The Share ended (revoked or expired): the Host no longer admits this device. */
  readonly ended: boolean;
}

export interface SharedWithMeView {
  readonly invites: ReadonlyArray<InviteView>;
  readonly sessions: ReadonlyArray<SharedSessionView>;
  /** Signed-in Accounts, by id, with their handle; the Account shows only when there are several. */
  readonly accounts: ReadonlyArray<{ readonly id: string; readonly login: string }>;
}

export interface SharingRequestOutputs {
  "sharing.share": ShareView;
  "sharing.list": ReadonlyArray<ShareView>;
  "sharing.sharedSessions": ReadonlyArray<string>;
  "sharing.renew": ShareView;
  "sharing.revoke": ShareView;
  /** The Host key and session the Teammate can now open. */
  "sharing.invite.accept": { readonly hostKey: string; readonly sessionId: string };
  "sharing.invite.decline": null;
  "sharing.invites.refresh": null;
}

export const SharingSubscriptionInputs = {
  /** Invites and sessions shared with this person; the whole view on every change. */
  "sharing.withMe": Schema.Struct({}),
  /** Who has the session open now (`shares.watchPresence`), the whole list on each change. */
  "sharing.presence": Schema.Struct(OnSession),
} as const;

export interface SharingSubscriptionItems {
  "sharing.withMe": SharedWithMeView;
  "sharing.presence": ReadonlyArray<PresenceView>;
}

/** `sharing.share`'s refusals, as `IpcError.code`. */
export const SHARING_ERRORS = {
  /** The login hasn't signed in to Polaris on that Account Server. */
  personNotFound: "PersonNotFound",
  /** The Polaris account was signed out on its server. */
  signedOut: "SignedOut",
} as const;
