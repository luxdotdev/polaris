/**
 * Shares (CONTEXT.md: Sharing; ADR 0112): one person's time-limited access to one Agent
 * Session or Constellation on the owner's Host, the share log, the Account Server statement
 * a Teammate's `hello` presents, and the RPCs the owner manages Shares with. What a Share's
 * Teammate may call is in `shareGrants.ts`. Capability `shares`.
 */
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { ConstellationId } from "./constellation/domain.ts";
import { NotFound, Unsupported } from "./errors.ts";
import { Actor, Grant, GRANT_KINDS } from "./extensions.ts";
import { InviteId, PersonId, SessionId, ShareId, Timestamp } from "./ids.ts";

/**
 * What is shared. A Constellation is shared through its Lead and covers its Workers'
 * sessions; a Worker's session is never a target on its own.
 */
export const ShareTarget = Schema.TaggedUnion({
  Session: { sessionId: SessionId },
  Constellation: { constellationId: ConstellationId },
});

export type ShareTarget = typeof ShareTarget.Type;

/** CONTEXT.md: Contributor, Commenter. */
export const ShareRole = Schema.Literals(["contributor", "commenter"]);

export type ShareRole = typeof ShareRole.Type;

/** The Grant a new Share of each role holds: every Grant, or watching and Comments. */
export const SHARE_ROLE_GRANTS: Readonly<Record<ShareRole, Grant>> = {
  contributor: GRANT_KINDS,
  commenter: ["read", "comment"],
};

/** The person a Share is for, as their Account Server described them when it was made. */
export class SharePerson extends Schema.Class<SharePerson>("SharePerson")({
  id: PersonId,
  /** Their handle on the Account Server, which the owner invited them by. */
  login: Schema.String,
  name: Schema.String,
  avatarUrl: Schema.NullOr(Schema.String),
  /** Credited on commits of work they sent; null when their Account names none. */
  commitEmail: Schema.NullOr(Schema.String),
}) {}

export class Share extends Schema.Class<Share>("Share")({
  id: ShareId,
  target: ShareTarget,
  /** The Account Server's issuer URL, pinned when the Invite was created. */
  issuer: Schema.String,
  person: SharePerson,
  role: ShareRole,
  grant: Grant,
  createdAt: Timestamp,
  /** A Share ends here unless renewed; at most `SHARE_MAX_LIFETIME_MS` ahead. */
  expiresAt: Timestamp,
  /** Set once revoked: the person's connections close and their devices are no longer admitted. */
  revokedAt: Schema.NullOr(Timestamp),
}) {}

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a Share lasts when the owner names no expiry. */
export const SHARE_DEFAULT_LIFETIME_MS = 7 * DAY_MS;

/** The furthest ahead a Share may expire, on creation and on each renewal. */
export const SHARE_MAX_LIFETIME_MS = 30 * DAY_MS;

/**
 * The expiry of a Share created or renewed at `now`: the default when none is asked
 * for, null when the one asked for is past or beyond the maximum (`ShareRefused`: `expiry`).
 */
export const shareExpiry = (now: number, requested: Timestamp | null): Timestamp | null => {
  if (requested === null) return new Date(now + SHARE_DEFAULT_LIFETIME_MS).toISOString();
  const at = Date.parse(requested);

  return at > now && at <= now + SHARE_MAX_LIFETIME_MS ? new Date(at).toISOString() : null;
};

/** A Share admits its person only while it is neither revoked nor expired. */
export const isShareLive = (share: Share, now: number): boolean =>
  share.revokedAt === null && Date.parse(share.expiresAt) > now;

const logged = {
  shareId: ShareId,
  at: Timestamp,
  /** Who did it; null when the Host did (an expiry, a device it learned from the issuer). */
  actor: Schema.NullOr(Actor),
};

/** One entry of a Share's log, oldest first: its whole history, kept after it ends. */
export const ShareLogEntry = Schema.TaggedUnion({
  /** The owner created the Invite and the Share that waits on it. */
  Invited: { ...logged, role: ShareRole, expiresAt: Timestamp },
  /** The person accepted the Invite on their Account Server. */
  Accepted: logged,
  /** A device of theirs was admitted for the first time. `deviceKey` is its relay key. */
  DeviceAdded: { ...logged, deviceKey: Schema.String, deviceName: Schema.NullOr(Schema.String) },
  Renewed: { ...logged, expiresAt: Timestamp },
  /** The owner changed what the Share allows. */
  Granted: { ...logged, role: ShareRole, grant: Grant },
  Revoked: logged,
  Expired: logged,
});

export type ShareLogEntry = typeof ShareLogEntry.Type;

// ── The Account Server's statement ──────────────────────────────────────────

/** How long a statement lives: signing a person out cuts them off within it (ADR 0112). */
export const STATEMENT_LIFETIME_S = 15 * 60;

/**
 * The claims of a statement, exactly as the Account Server signs them (apps/accounts/README.md):
 * an EdDSA JWT from `iss` binding the person `sub` to the device whose relay Noise key is
 * `cnf.noiseKey`. The Host checks it against that issuer's JWKS.
 */
export class StatementClaims extends Schema.Class<StatementClaims>("StatementClaims")({
  iss: Schema.String,
  /** The issuer again, when present. */
  aud: Schema.optionalKey(Schema.String),
  sub: PersonId,
  /** Seconds since the epoch, as JWTs carry them. */
  iat: Schema.optionalKey(Schema.Int),
  /** Not valid before this, when present. */
  nbf: Schema.optionalKey(Schema.Int),
  exp: Schema.Int,
  /** base64url of the device's X25519 static public key. */
  cnf: Schema.Struct({ noiseKey: Schema.String }),
  login: Schema.String,
  name: Schema.String,
  avatarUrl: Schema.NullOr(Schema.String),
  commitEmail: Schema.NullOr(Schema.String),
}) {}

/** `hello` or `account.refreshStatement` with a statement the Host does not accept. */
export class StatementRejected extends Schema.TaggedError<StatementRejected>()(
  "StatementRejected",
  {
    /**
     * `malformed`: not a statement. `signature`: no key of its issuer signed it. `expired`:
     * past `exp`, or not valid yet (`nbf`).
     * `issuer-unreachable`: its keys could not be fetched. `device`: bound to another device
     * than this connection's. `person`: another person than the connection's. `no-share`: no
     * live Share on this Host names that person at that issuer.
     */
    reason: Schema.Literals([
      "malformed",
      "signature",
      "expired",
      "issuer-unreachable",
      "device",
      "person",
      "no-share",
    ]),
  }
) {
  override get message(): string {
    return this.reason === "no-share"
      ? "Nothing on this host is shared with you"
      : "This host could not confirm who you are";
  }
}

/** A request outside what the connection's Shares cover, or one only the owner may make. */
export class NotShared extends Schema.TaggedError<NotShared>()("NotShared", {
  /** The RPC (`subscribeSession`) or Command (`dispatch:SendTurn`) that was refused. */
  what: Schema.String,
}) {
  override get message(): string {
    return `${this.what} is outside what is shared with you`;
  }
}

/**
 * Presents a newer statement on a Teammate's connection before the last one expires; the
 * Host closes the connection when it lapses. Answers the person's live Shares on this Host.
 */
export const RefreshStatement = Rpc.make("account.refreshStatement", {
  payload: { statement: Schema.RedactedFromValue(Schema.String) },
  success: Schema.Struct({ expiresAt: Timestamp, shares: Schema.Array(Share) }),
  error: Schema.Union([StatementRejected, Unsupported]),
});

// ── The owner's RPCs ────────────────────────────────────────────────────────

/** Why a Share could not be created or renewed. */
export class ShareRefused extends Schema.TaggedError<ShareRefused>()("ShareRefused", {
  /**
   * `expiry`: past, or beyond the maximum. `worker`: the target is a Worker's session, shared
   * only through its Constellation. `invite`: the issuer does not know the Invite or the
   * capability. `issuer-unreachable`. `ended`: a revoked Share is not renewed.
   */
  reason: Schema.Literals(["expiry", "worker", "invite", "issuer-unreachable", "ended"]),
}) {}

/**
 * Records a Share for the Invite the owner's Client made on the Account Server at `issuer`.
 * `personId` is that server's ID for the invitee (`GET /v1/people`), pinned on the Share from
 * the start; `inviteeLogin` is for display until their first statement names them.
 * `hostCapability` lets this Host ask that issuer for their accepted devices while the Share
 * is live; it never leaves the Host. `expiresAt` null takes the default.
 */
export const CreateShare = Rpc.make("shares.create", {
  payload: {
    target: ShareTarget,
    personId: PersonId,
    inviteeLogin: Schema.String,
    role: ShareRole,
    expiresAt: Schema.NullOr(Timestamp),
    issuer: Schema.String,
    inviteId: InviteId,
    hostCapability: Schema.RedactedFromValue(Schema.String),
  },
  success: Share,
  error: Schema.Union([NotFound, ShareRefused, Unsupported]),
});

/** Moves a live or expired Share's expiry; null takes the default from now. */
export const RenewShare = Rpc.make("shares.renew", {
  payload: { id: ShareId, expiresAt: Schema.NullOr(Timestamp) },
  success: Share,
  error: Schema.Union([NotFound, ShareRefused, Unsupported]),
});

/** Revokes a Share and closes its person's connections at once; revoking twice is fine. */
export const RevokeShare = Rpc.make("shares.revoke", {
  payload: { id: ShareId },
  success: Share,
  error: Schema.Union([NotFound, Unsupported]),
});

/** A Share with its log, oldest entry first. */
export class ShareListing extends Schema.Class<ShareListing>("ShareListing")({
  share: Share,
  log: Schema.Array(ShareLogEntry),
}) {}

/** This Host's Shares, ended ones included, newest first: all of them, or one target's. */
export const ListShares = Rpc.make("shares.list", {
  payload: { target: Schema.NullOr(ShareTarget) },
  success: Schema.Array(ShareListing),
  error: Unsupported,
});

/** Someone with the shared session or Constellation open now. */
export class SharePresenceEntry extends Schema.Class<SharePresenceEntry>("SharePresenceEntry")({
  /** `Teammate` for a Teammate; any other Actor is the owner on one of their own devices. */
  actor: Actor,
  avatarUrl: Schema.NullOr(Schema.String),
  /** When their earliest connection that still watches it subscribed. */
  since: Timestamp,
}) {}

/**
 * Who has a shared target open, as it changes: the current list first, then one per change.
 * Each person appears once however many devices they watch from. Never persisted.
 */
export const WatchSharePresence = Rpc.make("shares.watchPresence", {
  payload: { target: ShareTarget },
  success: Schema.Array(SharePresenceEntry),
  error: Schema.Union([NotFound, Unsupported]),
  stream: true,
});

/**
 * Mutes or unmutes pushes about a shared target for whoever calls: a Teammate's devices, or the
 * owner's Linked Devices. Each person's choice is their own; Needs You still shows in the apps.
 */
export const MuteShare = Rpc.make("shares.mute", {
  payload: { target: ShareTarget, muted: Schema.Boolean },
  error: Schema.Union([NotFound, Unsupported]),
});

export class ShareRpcs extends RpcGroup.make(
  CreateShare,
  RenewShare,
  RevokeShare,
  ListShares,
  WatchSharePresence,
  MuteShare,
  RefreshStatement
) {}
