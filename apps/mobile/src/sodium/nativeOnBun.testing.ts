/**
 * The native module's contract on sodium-native, as the Swift module implements it on the
 * phone. `noiseCheck.test.ts` bundles it in place of `native.ts`.
 */
import sodium from "sodium-native";
import type { NativeSodium } from "./shim.ts";

let calls = 0;

export const nativeCalls = () => calls;

const counted =
  <A extends Array<never>, R>(run: (...args: A) => R) =>
  (...args: A): R => {
    calls++;

    return run(...args);
  };

export const native: NativeSodium = {
  randombytes_buf: counted((buffer: Uint8Array) => sodium.randombytes_buf(buffer)),
  crypto_hash_sha256: counted((out: Uint8Array, input: Uint8Array) =>
    sodium.crypto_hash_sha256(out, input)
  ),
  crypto_sign_keypair: counted((pk: Uint8Array, sk: Uint8Array) =>
    sodium.crypto_sign_keypair(pk, sk)
  ),
  crypto_sign_seed_keypair: counted((pk: Uint8Array, sk: Uint8Array, seed: Uint8Array) =>
    sodium.crypto_sign_seed_keypair(pk, sk, seed)
  ),
  crypto_sign_detached: counted((sig: Uint8Array, message: Uint8Array, sk: Uint8Array) =>
    sodium.crypto_sign_detached(sig, message, sk)
  ),
  crypto_kx_keypair: counted((pk: Uint8Array, sk: Uint8Array) => sodium.crypto_kx_keypair(pk, sk)),
  crypto_kx_seed_keypair: counted((pk: Uint8Array, sk: Uint8Array, seed: Uint8Array) =>
    sodium.crypto_kx_seed_keypair(pk, sk, seed)
  ),
  crypto_scalarmult: counted((out: Uint8Array, sk: Uint8Array, pk: Uint8Array) =>
    sodium.crypto_scalarmult(out, sk, pk)
  ),
  crypto_scalarmult_base: counted((out: Uint8Array, sk: Uint8Array) =>
    sodium.crypto_scalarmult_base(out, sk)
  ),
  crypto_aead_chacha20poly1305_ietf_encrypt: counted(
    (c: Uint8Array, m: Uint8Array, ad: Uint8Array, nonce: Uint8Array, key: Uint8Array) =>
      sodium.crypto_aead_chacha20poly1305_ietf_encrypt(c, m, ad, null, nonce, key)
  ),
  crypto_aead_chacha20poly1305_ietf_decrypt: counted(
    (m: Uint8Array, c: Uint8Array, ad: Uint8Array, nonce: Uint8Array, key: Uint8Array) =>
      sodium.crypto_aead_chacha20poly1305_ietf_decrypt(m, null, c, ad, nonce, key)
  ),
  crypto_generichash: counted((out: Uint8Array, input: Uint8Array, key: Uint8Array) =>
    key.byteLength === 0
      ? sodium.crypto_generichash(out, input)
      : sodium.crypto_generichash(out, input, key)
  ),
};
