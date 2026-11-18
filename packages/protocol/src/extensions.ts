/**
 * Extensions (CONTEXT.md: Extension, Pairing, Grant): the Pairing an Extension
 * presents in `hello`, what its Grant allows, who did something (`Actor`), and
 * the RPCs a token-less Client uses to pair, list and revoke. The mapping of
 * every RPC and Command to the Grant it needs is in `grants.ts` (ADR 0075, 0078).
 */
import { Predicate, Schema } from "effect";
import { Rpc, RpcGroup, RpcMiddleware } from "effect/rpc";
import type { Capability } from "./capabilities.ts";
import { NotFound } from "./errors.ts";
import { LinkedDeviceId, PairingId, PersonId, ShareId, Timestamp } from "./ids.ts";

/**
 * One thing a Pairing or a Share allows: the Grant literal names are a contract with
 * Extensions. `comment` adds, edits and resolves Comments (ADR 0113).
 */
export const GrantKind = Schema.Literals(["read", "comment", "approve", "turn", "start", "voice"]);

export type GrantKind = typeof GrantKind.Type;

export const GRANT_KINDS: ReadonlyArray<GrantKind> = GrantKind.literals;

/** What a Pairing allows its Extension, or a Share its Teammate: a set, sent as an array. */
export const Grant = Schema.Array(GrantKind);

export type Grant = typeof Grant.Type;

export class Pairing extends Schema.Class<Pairing>("Pairing")({
  id: PairingId,
  /** What the user called the Extension when pairing, e.g. "Raycast". */
  name: Schema.String,
  grant: Grant,
  createdAt: Timestamp,
  /** When its token last opened a connection; null until it did. */
  lastUsedAt: Schema.NullOr(Timestamp),
  /** Set once revoked: the token no longer opens a connection. */
  revokedAt: Schema.NullOr(Timestamp),
}) {}

/**
 * Who sent a command: a token-less Client (the Desktop App), a paired Extension, a Linked
 * Device over the Polaris Relay, or a Teammate acting through a Share (ADR 0112). Clients
 * without `actor.linked-device` or `actor.teammate` read that variant as Client.
 */
export const Actor = Schema.TaggedUnion({
  Client: {},
  Extension: { pairingId: PairingId, name: Schema.String },
  LinkedDevice: { deviceId: LinkedDeviceId, name: Schema.String },
  /** `name` is the person's display name when they acted; `personId` is their issuer's. */
  Teammate: { shareId: ShareId, personId: PersonId, name: Schema.String },
});

export type Actor = typeof Actor.Type;

const CLIENT_ACTOR = Actor.cases.Client.make({});

/**
 * The Actor as a Client with `capabilities` can decode it: a variant the Client did not
 * announce becomes `Client`. The same value comes back when nothing changes.
 */
export const actorFor = (actor: Actor, capabilities: ReadonlyArray<Capability>): Actor => {
  if (Predicate.isTagged(actor, "LinkedDevice"))
    return capabilities.includes("actor.linked-device") ? actor : CLIENT_ACTOR;

  if (Predicate.isTagged(actor, "Teammate"))
    return capabilities.includes("actor.teammate") ? actor : CLIENT_ACTOR;

  return actor;
};

/** The prefix of every Extension token; the rest is base64url of 32 random bytes. */
export const EXTENSION_TOKEN_PREFIX = "pol_ext_";

/**
 * An Extension or a Teammate asked for more than its Grant allows. `needed` names the missing
 * Grant; null when `what` is not available to Extensions at all, or when `reason` says why.
 */
export class NotGranted extends Schema.TaggedError<NotGranted>()("NotGranted", {
  /** The RPC (`files.read`) or Command (`dispatch:SendTurn`) that was refused. */
  what: Schema.String,
  needed: Schema.NullOr(GrantKind),
  /** Product copy for a refusal no Grant lifts: only the owner may (`teammateCommandRefusal`). */
  reason: Schema.optionalKey(Schema.String),
}) {
  override get message(): string {
    if (this.reason !== undefined) return this.reason;

    return this.needed === null
      ? `${this.what} is not available to Extensions`
      : `${this.what} needs the ${this.needed} Grant`;
  }
}

/** `hello` with an `extensionToken` the Daemon does not accept. */
export class ExtensionTokenRejected extends Schema.TaggedError<ExtensionTokenRejected>()(
  "ExtensionTokenRejected",
  { reason: Schema.Literals(["malformed", "unknown", "revoked", "missing", "connection-bound"]) }
) {
  override get message(): string {
    return `The Extension token is ${this.reason === "revoked" ? "revoked" : "not valid"}`;
  }
}

/**
 * The Daemon refuses, with `NotGranted`, what a connection's Pairing does not
 * allow, in front of every handler. Clients need nothing for it.
 */
export class GrantGate extends RpcMiddleware.Service<GrantGate>()("polaris/protocol/GrantGate", {
  error: NotGranted,
}) {}

/**
 * Makes a Pairing; the token comes back once and is never stored or shown again.
 * `pairingString` carries it with this Host's identity and Remote Access URL (`pairingString.ts`).
 */
export const PairExtension = Rpc.make("extensions.pair", {
  payload: { name: Schema.String, grant: Grant },
  success: Schema.Struct({ pairing: Pairing, token: Schema.String, pairingString: Schema.String }),
});

export const ListPairings = Rpc.make("extensions.list", {
  success: Schema.Array(Pairing),
});

/** Revokes a Pairing and closes its live connections; revoking twice is fine. */
export const RevokePairing = Rpc.make("extensions.revoke", {
  payload: { id: PairingId },
  success: Pairing,
  error: NotFound,
});

export class ExtensionRpcs extends RpcGroup.make(PairExtension, ListPairings, RevokePairing) {}
