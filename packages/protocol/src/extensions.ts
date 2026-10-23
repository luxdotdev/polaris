/**
 * Extensions (CONTEXT.md: Extension, Pairing, Grant): the Pairing an Extension
 * presents in `hello`, what its Grant allows, who did something (`Actor`), and
 * the RPCs a token-less Client uses to pair, list and revoke. The mapping of
 * every RPC and Command to the Grant it needs is in `grants.ts` (ADR 0075, 0078).
 */
import { Schema } from "effect";
import { Rpc, RpcGroup, RpcMiddleware } from "effect/rpc";
import { NotFound } from "./errors.ts";
import { PairingId, Timestamp } from "./ids.ts";

/** One thing a Pairing allows: the Grant literal names are a contract with Extensions. */
export const GrantKind = Schema.Literals(["read", "approve", "turn", "start", "voice"]);

export type GrantKind = typeof GrantKind.Type;

export const GRANT_KINDS: ReadonlyArray<GrantKind> = GrantKind.literals;

/** What a Pairing allows its Extension to do on this Host: a set, sent as an array. */
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

/** Who sent a command: a token-less Client (the Desktop App) or a paired Extension. */
export const Actor = Schema.TaggedUnion({
  Client: {},
  Extension: { pairingId: PairingId, name: Schema.String },
});

export type Actor = typeof Actor.Type;

/** The prefix of every Extension token; the rest is base64url of 32 random bytes. */
export const EXTENSION_TOKEN_PREFIX = "pol_ext_";

/**
 * An Extension asked for more than its Grant allows. `needed` names the missing
 * Grant; null when `what` is not available to Extensions at all.
 */
export class NotGranted extends Schema.TaggedError<NotGranted>()("NotGranted", {
  /** The RPC (`files.read`) or Command (`dispatch:SendTurn`) that was refused. */
  what: Schema.String,
  needed: Schema.NullOr(GrantKind),
}) {
  override get message(): string {
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

/** Makes a Pairing; the token comes back once and is never stored or shown again. */
export const PairExtension = Rpc.make("extensions.pair", {
  payload: { name: Schema.String, grant: Grant },
  success: Schema.Struct({ pairing: Pairing, token: Schema.String }),
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
