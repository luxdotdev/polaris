/**
 * The part of `sodium-universal` that noise-handshake and `@polaris/protocol/relay/party` use,
 * over a native libsodium binding with sodium-native's calling convention (output buffers
 * first, written in place). Metro resolves `sodium-universal` to `universal.ts`, which binds it.
 */

/** What the `PolarisSodium` native module provides (modules/polaris-sodium). */
export interface NativeSodium {
  randombytes_buf(buffer: Uint8Array): void;
  crypto_hash_sha256(out: Uint8Array, input: Uint8Array): void;
  crypto_sign_keypair(publicKey: Uint8Array, secretKey: Uint8Array): void;
  crypto_sign_seed_keypair(publicKey: Uint8Array, secretKey: Uint8Array, seed: Uint8Array): void;
  crypto_sign_detached(signature: Uint8Array, message: Uint8Array, secretKey: Uint8Array): void;
  crypto_kx_keypair(publicKey: Uint8Array, secretKey: Uint8Array): void;
  crypto_kx_seed_keypair(publicKey: Uint8Array, secretKey: Uint8Array, seed: Uint8Array): void;
  crypto_scalarmult(out: Uint8Array, secretKey: Uint8Array, publicKey: Uint8Array): void;
  crypto_scalarmult_base(out: Uint8Array, secretKey: Uint8Array): void;
  crypto_aead_chacha20poly1305_ietf_encrypt(
    ciphertext: Uint8Array,
    message: Uint8Array,
    ad: Uint8Array,
    nonce: Uint8Array,
    key: Uint8Array
  ): number;
  crypto_aead_chacha20poly1305_ietf_decrypt(
    message: Uint8Array,
    ciphertext: Uint8Array,
    ad: Uint8Array,
    nonce: Uint8Array,
    key: Uint8Array
  ): number;
  /** An empty `key` hashes unkeyed. */
  crypto_generichash(out: Uint8Array, input: Uint8Array, key: Uint8Array): void;
}

const EMPTY = new Uint8Array(0);

const concat = (parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.byteLength, 0));
  let offset = 0;

  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }

  return out;
};

/** `sodium-universal`'s names and signatures over `native`. */
export const sodiumOver = (native: NativeSodium) => ({
  crypto_sign_PUBLICKEYBYTES: 32,
  crypto_sign_SECRETKEYBYTES: 64,
  crypto_sign_SEEDBYTES: 32,
  crypto_sign_BYTES: 64,
  crypto_kx_PUBLICKEYBYTES: 32,
  crypto_kx_SECRETKEYBYTES: 32,
  crypto_kx_SEEDBYTES: 32,
  crypto_scalarmult_BYTES: 32,
  crypto_scalarmult_SCALARBYTES: 32,
  crypto_aead_chacha20poly1305_ietf_KEYBYTES: 32,
  crypto_aead_chacha20poly1305_ietf_NPUBBYTES: 12,
  crypto_aead_chacha20poly1305_ietf_ABYTES: 16,
  crypto_generichash_BYTES: 32,
  crypto_hash_sha256_BYTES: 32,

  randombytes_buf: (buffer: Uint8Array) => native.randombytes_buf(buffer),
  crypto_hash_sha256: (out: Uint8Array, input: Uint8Array) => native.crypto_hash_sha256(out, input),
  crypto_sign_keypair: (pk: Uint8Array, sk: Uint8Array) => native.crypto_sign_keypair(pk, sk),
  crypto_sign_seed_keypair: (pk: Uint8Array, sk: Uint8Array, seed: Uint8Array) =>
    native.crypto_sign_seed_keypair(pk, sk, seed),
  crypto_sign_detached: (sig: Uint8Array, message: Uint8Array, sk: Uint8Array) =>
    native.crypto_sign_detached(sig, message, sk),
  crypto_kx_keypair: (pk: Uint8Array, sk: Uint8Array) => native.crypto_kx_keypair(pk, sk),
  crypto_kx_seed_keypair: (pk: Uint8Array, sk: Uint8Array, seed: Uint8Array) =>
    native.crypto_kx_seed_keypair(pk, sk, seed),
  crypto_scalarmult: (out: Uint8Array, sk: Uint8Array, pk: Uint8Array) =>
    native.crypto_scalarmult(out, sk, pk),
  crypto_scalarmult_base: (out: Uint8Array, sk: Uint8Array) =>
    native.crypto_scalarmult_base(out, sk),
  /** sodium-native's order: `nsec` is unused and must be null. */
  crypto_aead_chacha20poly1305_ietf_encrypt: (
    ciphertext: Uint8Array,
    message: Uint8Array,
    ad: Uint8Array | null,
    _nsec: null,
    nonce: Uint8Array,
    key: Uint8Array
  ) =>
    native.crypto_aead_chacha20poly1305_ietf_encrypt(ciphertext, message, ad ?? EMPTY, nonce, key),
  crypto_aead_chacha20poly1305_ietf_decrypt: (
    message: Uint8Array,
    _nsec: null,
    ciphertext: Uint8Array,
    ad: Uint8Array | null,
    nonce: Uint8Array,
    key: Uint8Array
  ) =>
    native.crypto_aead_chacha20poly1305_ietf_decrypt(message, ciphertext, ad ?? EMPTY, nonce, key),
  crypto_generichash: (out: Uint8Array, input: Uint8Array, key?: Uint8Array | null) =>
    native.crypto_generichash(out, input, key ?? EMPTY),
  /** BLAKE2b over the parts in order is BLAKE2b over their concatenation. */
  crypto_generichash_batch: (
    out: Uint8Array,
    parts: ReadonlyArray<Uint8Array>,
    key?: Uint8Array | null
  ) => native.crypto_generichash(out, concat(parts), key ?? EMPTY),
  sodium_memzero: (buffer: Uint8Array) => {
    buffer.fill(0);
  },
});

export type SodiumUniversal = ReturnType<typeof sodiumOver>;
