/**
 * `sodium-universal` on the Mobile App: metro.config.mjs resolves the package here, so
 * noise-handshake and the relay party code run on the native `PolarisSodium` module.
 */
import { native } from "./native.ts";
import { sodiumOver } from "./shim.ts";

const sodium = sodiumOver(native);

export const {
  crypto_sign_PUBLICKEYBYTES,
  crypto_sign_SECRETKEYBYTES,
  crypto_sign_SEEDBYTES,
  crypto_sign_BYTES,
  crypto_kx_PUBLICKEYBYTES,
  crypto_kx_SECRETKEYBYTES,
  crypto_kx_SEEDBYTES,
  crypto_scalarmult_BYTES,
  crypto_scalarmult_SCALARBYTES,
  crypto_aead_chacha20poly1305_ietf_KEYBYTES,
  crypto_aead_chacha20poly1305_ietf_NPUBBYTES,
  crypto_aead_chacha20poly1305_ietf_ABYTES,
  crypto_generichash_BYTES,
  crypto_hash_sha256_BYTES,
  randombytes_buf,
  crypto_hash_sha256,
  crypto_sign_keypair,
  crypto_sign_seed_keypair,
  crypto_sign_detached,
  crypto_kx_keypair,
  crypto_kx_seed_keypair,
  crypto_scalarmult,
  crypto_scalarmult_base,
  crypto_aead_chacha20poly1305_ietf_encrypt,
  crypto_aead_chacha20poly1305_ietf_decrypt,
  crypto_generichash,
  crypto_generichash_batch,
  sodium_memzero,
} = sodium;
