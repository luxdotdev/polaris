// oxlint-disable-next-line typescript/triple-slash-reference -- noise-handshake and sodium-universal ship no types; this carries them into every consumer.
/// <reference path="./vendor.d.ts" />
/**
 * The end-to-end channel between a Linked Device and a Daemon: Noise
 * `IK_25519_ChaChaPoly_BLAKE2b` (noise-handshake). The device initiates with
 * the host's static key from the link QR code; the host accepts only devices
 * it linked. Records are carrier-agnostic, so a later direct path carries them unchanged.
 *
 *   record = type:u8 tag:8 body
 *   type 1 = handshake init (Noise message 1)   type 2 = handshake reply (message 2)
 *   type 3 = data: one Noise transport message, authenticated with `type tag` as AD
 */
import Noise from "noise-handshake";
import CipherState from "noise-handshake/cipher";
import { generateKeyPair } from "noise-handshake/dh";
import { randombytes_buf } from "sodium-universal";
import { Schema } from "effect";
import { MAX_RECORD_BYTES } from "../wire.ts";

export const RecordType = { Init: 1, Reply: 2, Data: 3 } as const;

export const TAG_BYTES = 8;

const HEADER_BYTES = 1 + TAG_BYTES;

/** The largest plaintext in one data record: Noise's 65535-byte message less the 16-byte MAC. */
export const MAX_PLAINTEXT_CHUNK = 65_535 - 16;

/** Sessions stop before Noise's 32-bit nonce wraps; the device then handshakes again. */
const MAX_MESSAGES = 2 ** 32 - 1;

const PROLOGUE = new TextEncoder().encode("polaris-relay-e2e/1");

export interface StaticKeyPair {
  readonly publicKey: Uint8Array;
  readonly secretKey: Uint8Array;
}

export class RelayChannelError extends Schema.TaggedError<RelayChannelError>()(
  "RelayChannelError",
  {
    reason: Schema.Literals(["malformed", "not-linked", "decrypt-failed", "exhausted"]),
    message: Schema.String,
  }
) {}

/** A fresh X25519 static key pair for Noise. The private half never leaves its party. */
export const generateStaticKeyPair = (): StaticKeyPair => generateKeyPair();

/** The static key pair of a stored 32-byte X25519 secret key. */
export const staticKeyPairFromSecret = (secretKey: Uint8Array): StaticKeyPair =>
  generateKeyPair(secretKey);

export interface RecordHeader {
  readonly type: number;
  readonly tag: Uint8Array;
  readonly body: Uint8Array;
}

/** The record's type, session tag and body (views), or an error when it is too short or too long. */
export const readRecord = (record: Uint8Array): RecordHeader => {
  if (record.byteLength <= HEADER_BYTES || record.byteLength > MAX_RECORD_BYTES)
    throw new RelayChannelError({ reason: "malformed", message: "record has a bad length" });

  return {
    type: record[0] ?? 0,
    tag: record.subarray(1, HEADER_BYTES),
    body: record.subarray(HEADER_BYTES),
  };
};

const writeRecord = (type: number, tag: Uint8Array, body: Uint8Array): Uint8Array => {
  const out = new Uint8Array(HEADER_BYTES + body.byteLength);
  out[0] = type;
  out.set(tag, 1);
  out.set(body, HEADER_BYTES);

  return out;
};

const attempt = <A>(reason: RelayChannelError["reason"], message: string, run: () => A): A => {
  try {
    return run();
  } catch {
    throw new RelayChannelError({ reason, message });
  }
};

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.byteLength === b.byteLength && a.every((byte, i) => byte === b[i]);

/** One established Noise session: seals plaintext into data records and opens the peer's. */
export class RelaySession {
  private sent = 0;
  private received = 0;
  private readonly sender: CipherState;
  private readonly receiver: CipherState;
  private readonly ad: Uint8Array;

  constructor(
    readonly tag: Uint8Array,
    /** The peer's Noise static key, proven by the handshake. */
    readonly remoteStatic: Uint8Array,
    /** Noise's handshake hash: equal on both sides, usable as a channel binding. */
    readonly handshakeHash: Uint8Array,
    sendKey: Uint8Array,
    receiveKey: Uint8Array
  ) {
    this.sender = new CipherState(sendKey);
    this.receiver = new CipherState(receiveKey);
    this.ad = writeRecord(RecordType.Data, tag, new Uint8Array(0));
  }

  /** Data records for `bytes`, split into chunks of at most MAX_PLAINTEXT_CHUNK, in order. */
  seal(bytes: Uint8Array): Array<Uint8Array> {
    const records: Array<Uint8Array> = [];
    let offset = 0;

    do {
      if (this.sent >= MAX_MESSAGES)
        throw new RelayChannelError({
          reason: "exhausted",
          message: "session needs a new handshake",
        });
      const chunk = bytes.subarray(offset, offset + MAX_PLAINTEXT_CHUNK);
      records.push(writeRecord(RecordType.Data, this.tag, this.sender.encrypt(chunk, this.ad)));
      this.sent++;
      offset += MAX_PLAINTEXT_CHUNK;
    } while (offset < bytes.byteLength);

    return records;
  }

  /** The plaintext of the next data record. Records must arrive in order; a gap fails here. */
  open(record: Uint8Array): Uint8Array {
    const { type, tag, body } = readRecord(record);

    if (type !== RecordType.Data || !sameBytes(tag, this.tag))
      throw new RelayChannelError({
        reason: "malformed",
        message: "not a data record of this session",
      });

    if (this.received >= MAX_MESSAGES)
      throw new RelayChannelError({
        reason: "exhausted",
        message: "session needs a new handshake",
      });

    const plaintext = attempt("decrypt-failed", "record failed authentication", () =>
      this.receiver.decrypt(body, this.ad)
    );

    this.received++;

    return plaintext;
  }
}

/** The device's half of a handshake: `init` goes to the host, its reply comes back to `finish`. */
export class RelayInitiator {
  readonly tag = new Uint8Array(TAG_BYTES);
  readonly init: Uint8Array;
  private readonly noise: Noise;

  /** `payload` travels encrypted to the host inside the init (a link request, ADR 0083). */
  constructor(local: StaticKeyPair, hostStatic: Uint8Array, payload?: Uint8Array) {
    randombytes_buf(this.tag);
    this.noise = new Noise("IK", true, local);
    this.noise.initialise(PROLOGUE, hostStatic);
    this.init = writeRecord(RecordType.Init, this.tag, this.noise.send(payload));
  }

  finish(reply: Uint8Array): RelaySession {
    const { type, tag, body } = readRecord(reply);

    if (type !== RecordType.Reply || !sameBytes(tag, this.tag))
      throw new RelayChannelError({ reason: "malformed", message: "not this handshake's reply" });
    attempt("decrypt-failed", "handshake reply failed", () => this.noise.recv(body));

    return sessionOf(this.noise, this.tag);
  }
}

const sessionOf = (noise: Noise, tag: Uint8Array): RelaySession => {
  if (!noise.complete || noise.rs === null)
    throw new RelayChannelError({ reason: "malformed", message: "handshake incomplete" });

  // noise-handshake: `rx` encrypts to the peer and `tx` decrypts from it.
  return new RelaySession(tag, noise.rs, noise.hash, noise.rx, noise.tx);
};

/**
 * The host's half: answers a device's init when `isLinked` accepts the device's
 * proven static key, before anything is sent back.
 */
export interface AcceptedHandshake {
  readonly session: RelaySession;
  /** The record to send back to the device. */
  readonly reply: Uint8Array;
}

/**
 * `isLinked` also gets the init's decrypted payload (empty unless the device sent one),
 * so a host can accept a device it is linking from what the payload proves.
 */
export const acceptHandshake = (
  local: StaticKeyPair,
  init: Uint8Array,
  isLinked: (deviceStatic: Uint8Array, payload: Uint8Array) => boolean
): AcceptedHandshake => {
  const { type, tag, body } = readRecord(init);

  if (type !== RecordType.Init)
    throw new RelayChannelError({ reason: "malformed", message: "not a handshake init" });
  const noise = new Noise("IK", false, local);
  noise.initialise(PROLOGUE);
  const payload = attempt("decrypt-failed", "handshake init failed", () => noise.recv(body));

  if (noise.rs === null || !isLinked(noise.rs, payload))
    throw new RelayChannelError({ reason: "not-linked", message: "device is not linked" });
  const reply = writeRecord(RecordType.Reply, tag, noise.send());

  return { session: sessionOf(noise, tag.slice()), reply };
};
