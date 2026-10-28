/**
 * What the shared code takes from WebCrypto, which Hermes lacks: `getRandomValues` (blob ids)
 * and SHA-256 `digest` (relay addresses), on the native libsodium module. Imported first.
 */
import { native } from "./native.ts";

const toBytes = (data: ArrayBuffer | ArrayBufferView): Uint8Array =>
  data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

/** Only SHA-256, by name: the one digest the shared code asks for. */
const digest = async (name: string, data: ArrayBuffer | ArrayBufferView): Promise<ArrayBuffer> => {
  if (name.toUpperCase() !== "SHA-256") throw new Error(`digest ${name} is not available here`);
  const out = new Uint8Array(32);
  native.crypto_hash_sha256(out, toBytes(data).slice());

  return out.buffer;
};

const getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
  if (array !== null)
    native.randombytes_buf(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));

  return array;
};

// Hermes has no `crypto` at all; an engine that has one keeps its own.
if (!("crypto" in globalThis))
  Object.defineProperty(globalThis, "crypto", {
    value: { getRandomValues, subtle: { digest } },
    configurable: true,
  });
