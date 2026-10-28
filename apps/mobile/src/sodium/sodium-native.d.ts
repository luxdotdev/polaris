/** The parts of sodium-native the Bun-side native contract uses; it ships no types. */
declare module "sodium-native" {
  type Bytes = Uint8Array;

  const sodium: {
    randombytes_buf(buffer: Bytes): void;
    crypto_hash_sha256(out: Bytes, input: Bytes): void;
    crypto_sign_keypair(pk: Bytes, sk: Bytes): void;
    crypto_sign_seed_keypair(pk: Bytes, sk: Bytes, seed: Bytes): void;
    crypto_sign_detached(sig: Bytes, message: Bytes, sk: Bytes): void;
    crypto_kx_keypair(pk: Bytes, sk: Bytes): void;
    crypto_kx_seed_keypair(pk: Bytes, sk: Bytes, seed: Bytes): void;
    crypto_scalarmult(out: Bytes, sk: Bytes, pk: Bytes): void;
    crypto_scalarmult_base(out: Bytes, sk: Bytes): void;
    crypto_aead_chacha20poly1305_ietf_encrypt(
      c: Bytes,
      m: Bytes,
      ad: Bytes,
      nsec: null,
      nonce: Bytes,
      key: Bytes
    ): number;
    crypto_aead_chacha20poly1305_ietf_decrypt(
      m: Bytes,
      nsec: null,
      c: Bytes,
      ad: Bytes,
      nonce: Bytes,
      key: Bytes
    ): number;
    crypto_generichash(out: Bytes, input: Bytes, key?: Bytes): void;
  };

  export default sodium;
}
