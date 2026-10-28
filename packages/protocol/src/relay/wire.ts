/**
 * The Polaris Relay's wire format (ADR 0080; apps/relay/README.md is the contract).
 *
 * Control messages travel as WebSocket text messages of JSON, data as binary
 * messages: `version:u8 op:u8 peerLength:u8 peer:ascii payload`. The relay
 * reads only the header; the payload is an end-to-end record it cannot open.
 */
import { Option, Schema } from "effect";
import { Base64Url } from "effect/encoding";

export const RELAY_WIRE_VERSION = 1;

/** The WebSocket path a party dials: `wss://<relay>/v1`. */
export const RELAY_PATH = "/v1";

export const RelayOp = {
  /** Client → relay: deliver to `peer`. Relay → client: from `peer`. */
  Forward: 1,
} as const;

/** The largest end-to-end record a data frame may carry (one Noise message plus its header). */
export const MAX_RECORD_BYTES = 65_535 + 9;

export const MAX_ADDRESS_LENGTH = 64;

/** The largest WebSocket message the relay accepts: a data frame's header plus a full record. */
export const MAX_RELAY_MESSAGE_BYTES = 3 + MAX_ADDRESS_LENGTH + MAX_RECORD_BYTES;

export const NONCE_BYTES = 32;

/** Why the relay closed a connection; sent as the WebSocket close code. */
export const RelayClose = {
  /** A malformed or out-of-order message. */
  BadMessage: 4400,
  /** The key proof failed. */
  AuthFailed: 4401,
  /** No proof arrived within the auth timeout. */
  AuthTimeout: 4408,
  /** A newer connection proved the same key. */
  Replaced: 4409,
  /** The connection exceeded its message or byte rate. */
  RateLimited: 4429,
  /** The relay is at its connection limit. */
  Full: 4503,
} as const;

export const RelayRole = Schema.Literals(["host", "device"]);

export type RelayRole = typeof RelayRole.Type;

/** A party's relay address: base64url of the first 16 bytes of SHA-256 over its Ed25519 public key. */
export const RelayAddress = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{22}$/)).pipe(
  Schema.brand("RelayAddress")
);

export type RelayAddress = typeof RelayAddress.Type;

export const RelayLimits = Schema.Struct({
  maxMessageBytes: Schema.Int,
  maxPeers: Schema.Int,
  messagesPerSecond: Schema.Int,
  bytesPerSecond: Schema.Int,
  authTimeoutMs: Schema.Int,
  idleTimeoutSeconds: Schema.Int,
});

export type RelayLimits = typeof RelayLimits.Type;

export const Challenge = Schema.Struct({
  t: Schema.Literal("challenge"),
  v: Schema.Literal(RELAY_WIRE_VERSION),
  nonce: Schema.String,
  limits: RelayLimits,
  /** The relay forwards `wake` to the push service; absent from relays without push. */
  push: Schema.optionalKey(Schema.Boolean),
});

export const Auth = Schema.Struct({
  t: Schema.Literal("auth"),
  role: RelayRole,
  /** The party's Ed25519 public key, base64url. */
  key: Schema.String,
  /** Ed25519 over `authMessage(nonce, role)`, base64url. */
  sig: Schema.String,
  /** A host's linked devices; a device sends none. */
  peers: Schema.optionalKey(Schema.Array(RelayAddress)),
});

export const Ready = Schema.Struct({ t: Schema.Literal("ready"), address: RelayAddress });

/** A host replaces its linked devices. */
export const Peers = Schema.Struct({
  t: Schema.Literal("peers"),
  peers: Schema.Array(RelayAddress),
});

export const Presence = Schema.Struct({
  t: Schema.Literal("presence"),
  peer: RelayAddress,
  online: Schema.Boolean,
});

/** A forward was dropped: the peer is offline or not linked to the sender. */
export const Unreachable = Schema.Struct({ t: Schema.Literal("unreachable"), peer: RelayAddress });

/** Which APNs endpoint a device token belongs to: development builds use the sandbox. */
export const PushEnvironment = Schema.Literals(["sandbox", "production"]);

export type PushEnvironment = typeof PushEnvironment.Type;

/** An APNs device token as lowercase hex. */
export const ApnsToken = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64,200}$/));

/** The largest sealed push payload, base64url: APNs allows 4 KiB for the whole notification. */
export const MAX_WAKE_PAYLOAD_CHARS = 3000;

export const WakeId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,32}$/));

/**
 * A host asks the relay to wake one of its linked devices, online or not. `payload` is
 * sealed to the device (`relay/push.ts`); the relay and the push service see only the token.
 */
export const Wake = Schema.Struct({
  t: Schema.Literal("wake"),
  id: WakeId,
  peer: RelayAddress,
  token: ApnsToken,
  environment: PushEnvironment,
  payload: Schema.String.check(
    Schema.isPattern(/^[A-Za-z0-9_-]+$/),
    Schema.isMaxLength(MAX_WAKE_PAYLOAD_CHARS)
  ),
});

export type Wake = typeof Wake.Type;

/**
 * What became of a wake. `unregistered`: APNs no longer knows the token, so drop it.
 * `unlinked`: the host doesn't list the device. `refused`: the push service refused it
 * (a production token on a preview deployment, a bad request). `unavailable`: try later.
 */
export const WakeOutcome = Schema.Literals([
  "sent",
  "unlinked",
  "rate-limited",
  "unregistered",
  "refused",
  "unavailable",
]);

export type WakeOutcome = typeof WakeOutcome.Type;

export const Woken = Schema.Struct({
  t: Schema.Literal("woken"),
  id: WakeId,
  outcome: WakeOutcome,
});

export const ClientControl = Schema.Union([Auth, Peers, Wake]);

export type ClientControl = typeof ClientControl.Type;

export const RelayControl = Schema.Union([Challenge, Ready, Presence, Unreachable, Woken]);

export type RelayControl = typeof RelayControl.Type;

export const decodeClientControl = Schema.decodeUnknownOption(Schema.fromJsonString(ClientControl));

export const decodeRelayControl = Schema.decodeUnknownOption(Schema.fromJsonString(RelayControl));

export const encodeControl = (message: ClientControl | RelayControl): string =>
  JSON.stringify(message);

const encoder = new TextEncoder();

const decoder = new TextDecoder();

const AUTH_CONTEXT = encoder.encode("polaris-relay/1 auth\0");

/** The bytes a party signs to prove its key: a fixed context, the relay's nonce and the role. */
export const authMessage = (nonce: Uint8Array, role: RelayRole): Uint8Array => {
  const out = new Uint8Array(AUTH_CONTEXT.byteLength + nonce.byteLength + 1);
  out.set(AUTH_CONTEXT);
  out.set(nonce, AUTH_CONTEXT.byteLength);
  out[out.byteLength - 1] = role === "host" ? 1 : 2;

  return out;
};

const decodeAddress = Schema.decodeSync(RelayAddress);

/** WebCrypto takes only ArrayBuffer-backed views; this copies into one. */
const owned = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes);

export const relayAddress = async (publicKey: Uint8Array): Promise<RelayAddress> => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", owned(publicKey)));

  return decodeAddress(Base64Url.encode(digest.subarray(0, 16)));
};

export const fromBase64Url = (text: string): Option.Option<Uint8Array> =>
  Option.getSuccess(Base64Url.decode(text));

export const toBase64Url = (bytes: Uint8Array): string => Base64Url.encode(bytes);

/** Whether `signature` is `publicKey`'s Ed25519 signature over `message` (WebCrypto). */
export const verifyEd25519 = async (
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array
): Promise<boolean> => {
  if (publicKey.byteLength !== 32 || signature.byteLength !== 64) return false;

  try {
    const key = await crypto.subtle.importKey("raw", owned(publicKey), { name: "Ed25519" }, false, [
      "verify",
    ]);

    return await crypto.subtle.verify("Ed25519", key, owned(signature), owned(message));
  } catch {
    return false;
  }
};

export interface DataFrame {
  readonly op: number;
  readonly peer: string;
  readonly payload: Uint8Array;
}

export const encodeDataFrame = (op: number, peer: string, payload: Uint8Array): Uint8Array => {
  const address = encoder.encode(peer);
  const out = new Uint8Array(3 + address.byteLength + payload.byteLength);
  out[0] = RELAY_WIRE_VERSION;
  out[1] = op;
  out[2] = address.byteLength;
  out.set(address, 3);
  out.set(payload, 3 + address.byteLength);

  return out;
};

/** The frame, or none when the header is malformed or names another version. The payload is a view. */
export const decodeDataFrame = (bytes: Uint8Array): Option.Option<DataFrame> => {
  if (bytes.byteLength < 3 || bytes[0] !== RELAY_WIRE_VERSION) return Option.none();
  const length = bytes[2] ?? 0;

  if (length === 0 || length > MAX_ADDRESS_LENGTH || bytes.byteLength < 3 + length)
    return Option.none();

  return Option.some({
    op: bytes[1] ?? 0,
    peer: decoder.decode(bytes.subarray(3, 3 + length)),
    payload: bytes.subarray(3 + length),
  });
};
