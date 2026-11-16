/**
 * Enrolling the user's Desktop Apps on a Host (ENG-927, ADR 0114): the user keys a Host has
 * enrolled, the requests from keys it doesn't know, and how a Desktop App that holds user access
 * allows, denies and revokes them. The user gate itself is `userAccess.ts`.
 */
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { NotFound } from "./errors.ts";

/** Names an enrolled key or a request: the start of the key's digest, never the key. */
export const UserAccessId = Schema.String.check(Schema.isPattern(/^[a-f0-9]{16}$/)).pipe(
  Schema.brand("UserAccessId")
);

export type UserAccessId = typeof UserAccessId.Type;

/** A Desktop App whose user key this Host enrolled. */
export class EnrolledApp extends Schema.Class<EnrolledApp>("EnrolledApp")({
  id: UserAccessId,
  /** The device label its `hello` gave when it was enrolled. */
  label: Schema.String,
  enrolledAt: Schema.String,
  /** The watching connection presented this key. */
  self: Schema.Boolean,
  /** A connection presenting this key is open now. */
  connected: Schema.Boolean,
}) {}

/** A Desktop App with a key this Host hasn't enrolled, waiting for an enrolled one to allow it. */
export class UserAccessRequest extends Schema.Class<UserAccessRequest>("UserAccessRequest")({
  id: UserAccessId,
  label: Schema.String,
  /** Shown by both Desktop Apps, so the user can tell the request is the one they made. */
  code: Schema.String,
  requestedAt: Schema.String,
}) {}

/**
 * `held`: this connection has user access. `waiting`: its key is not enrolled and a request is
 * open. `none`: it presented no key, or its request was denied or couldn't be opened.
 */
export const UserAccessStanding = Schema.Literals(["held", "waiting", "none"]);

export type UserAccessStanding = typeof UserAccessStanding.Type;

/** What a connection sees of a Host's user access; the lists are empty unless it holds it. */
export class UserAccessState extends Schema.Class<UserAccessState>("UserAccessState")({
  standing: UserAccessStanding,
  /** The code of this connection's own request while it waits; null otherwise. */
  code: Schema.NullOr(Schema.String),
  enrolled: Schema.Array(EnrolledApp),
  requests: Schema.Array(UserAccessRequest),
}) {}

/** This connection's user access now, then again on every change (capability `user-access.enrolment`). */
export const WatchUserAccess = Rpc.make("userAccess.watch", {
  success: UserAccessState,
  stream: true,
});

/** Enrols a waiting key: its open connections hold user access at once. */
export const AllowUserAccess = Rpc.make("userAccess.allow", {
  payload: { id: UserAccessId },
  success: EnrolledApp,
  error: NotFound,
});

/** Closes a request without enrolling; that Desktop App asks again when it reconnects. */
export const DenyUserAccess = Rpc.make("userAccess.deny", {
  payload: { id: UserAccessId },
  error: NotFound,
});

/** Removes an enrolled key: its open connections lose user access at once. */
export const RevokeUserAccess = Rpc.make("userAccess.revoke", {
  payload: { id: UserAccessId },
  success: EnrolledApp,
  error: NotFound,
});

export class UserAccessRpcs extends RpcGroup.make(
  WatchUserAccess,
  AllowUserAccess,
  DenyUserAccess,
  RevokeUserAccess
) {}
