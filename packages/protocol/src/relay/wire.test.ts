import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { generateRelayIdentity, proveRelayKey } from "./party/identity.ts";
import {
  authMessage,
  decodeClientControl,
  decodeDataFrame,
  encodeDataFrame,
  RELAY_WIRE_VERSION,
  RelayOp,
  verifyEd25519,
} from "./wire.ts";

describe("relay wire", () => {
  test("a party's libsodium proof verifies under the relay's WebCrypto, for that nonce and role only", async () => {
    const identity = generateRelayIdentity();
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const proof = proveRelayKey(identity, nonce, "host");

    expect(await verifyEd25519(identity.publicKey, authMessage(nonce, "host"), proof)).toBe(true);
    expect(await verifyEd25519(identity.publicKey, authMessage(nonce, "device"), proof)).toBe(
      false
    );
    const otherNonce = crypto.getRandomValues(new Uint8Array(32));
    expect(await verifyEd25519(identity.publicKey, authMessage(otherNonce, "host"), proof)).toBe(
      false
    );
    const stranger = generateRelayIdentity().publicKey;
    expect(await verifyEd25519(stranger, authMessage(nonce, "host"), proof)).toBe(false);
  });

  test("a garbage key or signature is a failed proof, not a throw", async () => {
    const message = authMessage(new Uint8Array(32), "device");

    expect(await verifyEd25519(new Uint8Array(32), message, new Uint8Array(64))).toBe(false);
    expect(await verifyEd25519(new Uint8Array(5), message, new Uint8Array(64))).toBe(false);
  });

  test("data frames round-trip and reject bad headers", () => {
    const payload = new Uint8Array([9, 8, 7]);
    const frame = encodeDataFrame(RelayOp.Forward, "AAAAAAAAAAAAAAAAAAAAAA", payload);
    const decoded = Option.getOrThrow(decodeDataFrame(frame));

    expect(decoded.peer).toBe("AAAAAAAAAAAAAAAAAAAAAA");
    expect([...decoded.payload]).toEqual([9, 8, 7]);

    const otherVersion = frame.slice();
    otherVersion[0] = RELAY_WIRE_VERSION + 1;
    expect(Option.isNone(decodeDataFrame(otherVersion))).toBe(true);
    expect(Option.isNone(decodeDataFrame(frame.subarray(0, 10)))).toBe(true);
    expect(Option.isNone(decodeDataFrame(new Uint8Array([1, 1, 0])))).toBe(true);
  });

  test("control decoding refuses unknown messages and malformed addresses", () => {
    expect(Option.isSome(decodeClientControl('{"t":"peers","peers":[]}'))).toBe(true);
    expect(Option.isNone(decodeClientControl('{"t":"peers","peers":["../etc"]}'))).toBe(true);
    expect(Option.isNone(decodeClientControl('{"t":"ready","address":"x"}'))).toBe(true);
    expect(Option.isNone(decodeClientControl("not json"))).toBe(true);
  });
});
