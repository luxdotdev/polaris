/**
 * Push notifications to a Linked Device (apps/relay/README.md: Push). The Daemon seals a
 * `PushMessage` to the device's push key with HPKE (RFC 9180, base mode) and sends it in a
 * `wake`; the relay and the push service carry it opaquely; the app's Notification Service
 * Extension opens it. Schemas and constants only: sealing lives in the Daemon, opening in Swift.
 */
import { Schema } from "effect";
import { ApnsToken, PushEnvironment } from "./wire.ts";

/** HPKE suite: DHKEM(P-256, HKDF-SHA256), HKDF-SHA256, AES-256-GCM (CryptoKit's `P256_SHA256_AES_GCM_256`). */
export const PUSH_HPKE_SUITE = { kem: 0x0010, kdf: 0x0001, aead: 0x0002 } as const;

/** HPKE `info`, binding a sealed payload to this use and version. */
export const PUSH_HPKE_INFO = "polaris-push/1";

/** A P-256 public key, uncompressed (65 bytes), base64url without padding. */
export const PushKey = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{87}$/));

/** The sealed payload is base64url of `enc` (65 bytes) ‖ ciphertext; its AAD is empty. */
export const PUSH_ENC_BYTES = 65;

/** How the app offers a notification: Approve / Always here / Deny, an answer, or none. */
export const PushCategory = Schema.Literals(["approval", "question"]);

export type PushCategory = typeof PushCategory.Type;

/** The plaintext inside a sealed push: what the notification shows and what its buttons answer. */
export const PushMessage = Schema.Struct({
  v: Schema.Literal(1),
  kind: Schema.Literals(["needs-you", "turn-ended"]),
  hostId: Schema.String,
  hostName: Schema.String,
  sessionId: Schema.String,
  /** The pending approval or question a Needs You push answers; null for a finished Turn. */
  requestId: Schema.NullOr(Schema.String),
  category: Schema.NullOr(PushCategory),
  title: Schema.String.check(Schema.isMaxLength(120)),
  subtitle: Schema.String.check(Schema.isMaxLength(160)),
  body: Schema.String.check(Schema.isMaxLength(600)),
  /** When the Host decided to send it (ISO 8601). */
  at: Schema.String,
});

export type PushMessage = typeof PushMessage.Type;

export const encodePushMessage = Schema.encodeSync(Schema.fromJsonString(PushMessage));

export const decodePushMessage = Schema.decodeUnknownOption(Schema.fromJsonString(PushMessage));

/** What a device registers with each Host it links, over its end-to-end session. */
export const PushRegistration = Schema.Struct({
  token: ApnsToken,
  environment: PushEnvironment,
  pushKey: PushKey,
});

export type PushRegistration = typeof PushRegistration.Type;
