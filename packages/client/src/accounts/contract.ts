/**
 * The Account Server's `/v1` bodies as Effect Schemas (apps/accounts/README.md is the contract),
 * and the one failure every Accounts call ends in.
 */
import { Schema } from "effect";

/** A person as `GET /v1/people` returns them. */
export const Person = Schema.Struct({
  personId: Schema.String,
  login: Schema.String,
  name: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
});

export type Person = typeof Person.Type;

/** `GET /v1/me`: the person, the address their work is credited to, and the ones they may pick. */
export const Me = Schema.Struct({
  ...Person.fields,
  commitEmail: Schema.String,
  commitEmails: Schema.Array(Schema.String),
});

export type Me = typeof Me.Type;

export const ShareRole = Schema.Literals(["contributor", "commenter"]);

export type ShareRole = typeof ShareRole.Type;

export const SharedThing = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  kind: Schema.Literals(["session", "constellation"]),
});

export type SharedThing = typeof SharedThing.Type;

/** The owner's Host as an Invite carries it: its relay address and Noise key. */
export const InviteHost = Schema.Struct({
  name: Schema.String,
  relayAddress: Schema.String,
  noiseKey: Schema.String,
});

export type InviteHost = typeof InviteHost.Type;

/** `GET /v1/invites`: one Invite waiting for this person. */
export const PendingInvite = Schema.Struct({
  inviteId: Schema.String,
  owner: Person,
  share: SharedThing,
  host: Schema.Struct({ name: Schema.String }),
  role: ShareRole,
  expiresAt: Schema.String,
});

export type PendingInvite = typeof PendingInvite.Type;

/** `POST /v1/invites/{id}/accept`: where to reach the shared thing. */
export const AcceptedInvite = Schema.Struct({
  host: InviteHost,
  share: SharedThing,
  role: ShareRole,
  owner: Person,
});

export type AcceptedInvite = typeof AcceptedInvite.Type;

/** `POST /v1/invites`, which the owner's Daemon later reads devices with (`hostCapability`). */
export const NewInvite = Schema.Struct({
  inviteeLogin: Schema.String,
  share: SharedThing,
  host: InviteHost,
  role: ShareRole,
  expiresAt: Schema.String,
});

export type NewInvite = typeof NewInvite.Type;

export const CreatedInvite = Schema.Struct({
  inviteId: Schema.String,
  hostCapability: Schema.String,
});

export type CreatedInvite = typeof CreatedInvite.Type;

/** The accepting device: its relay address and Noise static key. */
export const AcceptingDevice = Schema.Struct({
  relayAddress: Schema.String,
  noiseKey: Schema.String,
});

export type AcceptingDevice = typeof AcceptingDevice.Type;

export const TokenBody = Schema.Struct({ token: Schema.String });

export const StatementBody = Schema.Struct({ jwt: Schema.String });

/** Better Auth's device authorization start. */
export const DeviceCodeBody = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri_complete: Schema.String,
  expires_in: Schema.Number,
  interval: Schema.optionalKey(Schema.Number),
});

export const DeviceTokenBody = Schema.Struct({ access_token: Schema.String });

export const DeviceTokenError = Schema.Struct({ error: Schema.String });

/** Any error body: the server's `_tag` when it sent one. */
export const ErrorBody = Schema.Struct({ _tag: Schema.optionalKey(Schema.String) });

export const AccountsFailure = Schema.Literals([
  /** Not an https origin (http only on loopback, for a local Account Server). */
  "invalid-server",
  /** The server refused the Account's session: it was signed out, revoked or expired. */
  "signed-out",
  /** No such Account on this device. */
  "unknown-account",
  /** The server answered with an error: `serverTag` and `status` say which. */
  "refused",
  /** The server couldn't be reached, or answered with something that isn't the contract. */
  "unreachable",
  /** The sign-in was cancelled, or its browser redirect didn't match. */
  "sign-in-failed",
  /** The device's secret store refused the session token. */
  "storage",
]);

export type AccountsFailure = typeof AccountsFailure.Type;

export class AccountsError extends Schema.TaggedError<AccountsError>()("AccountsError", {
  reason: AccountsFailure,
  message: Schema.String,
  status: Schema.optionalKey(Schema.Number),
  /** The Account Server's error `_tag` (`PersonNotFound`, `InviteClosed`…). */
  serverTag: Schema.optionalKey(Schema.String),
}) {}

export const accountsError = (reason: AccountsFailure, message: string) =>
  new AccountsError({ reason, message });
