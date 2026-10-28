// libsodium for the Mobile App, in sodium-native's calling convention: the caller passes
// output buffers, written in place. Every length is checked before libsodium sees a pointer.
import Clibsodium
import ExpoModulesCore

final class SodiumException: GenericException<String> {
  override var reason: String { param }
}

private func bytes(_ array: Uint8Array) -> UnsafeMutablePointer<UInt8> {
  array.rawPointer.assumingMemoryBound(to: UInt8.self)
}

private func expect(_ array: Uint8Array, _ length: Int, _ name: String) throws {
  if array.byteLength != length {
    throw SodiumException("\(name) must be \(length) bytes, not \(array.byteLength)")
  }
}

private func succeed(_ status: Int32, _ what: String) throws {
  if status != 0 { throw SodiumException(what) }
}

public final class PolarisSodiumModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PolarisSodium")

    OnCreate {
      if sodium_init() < 0 { fatalError("libsodium failed to initialise") }
    }

    Function("randombytes_buf") { (buffer: Uint8Array) in
      randombytes_buf(buffer.rawPointer, buffer.byteLength)
    }

    Function("crypto_hash_sha256") { (out: Uint8Array, input: Uint8Array) throws in
      try expect(out, Int(crypto_hash_sha256_BYTES), "out")
      try succeed(
        crypto_hash_sha256(bytes(out), bytes(input), UInt64(input.byteLength)), "sha256 failed")
    }

    Function("crypto_sign_keypair") { (pk: Uint8Array, sk: Uint8Array) throws in
      try expect(pk, Int(crypto_sign_PUBLICKEYBYTES), "publicKey")
      try expect(sk, Int(crypto_sign_SECRETKEYBYTES), "secretKey")
      try succeed(crypto_sign_keypair(bytes(pk), bytes(sk)), "sign keypair failed")
    }

    Function("crypto_sign_seed_keypair") { (pk: Uint8Array, sk: Uint8Array, seed: Uint8Array) throws in
      try expect(pk, Int(crypto_sign_PUBLICKEYBYTES), "publicKey")
      try expect(sk, Int(crypto_sign_SECRETKEYBYTES), "secretKey")
      try expect(seed, Int(crypto_sign_SEEDBYTES), "seed")
      try succeed(crypto_sign_seed_keypair(bytes(pk), bytes(sk), bytes(seed)), "seed keypair failed")
    }

    Function("crypto_sign_detached") { (sig: Uint8Array, message: Uint8Array, sk: Uint8Array) throws in
      try expect(sig, Int(crypto_sign_BYTES), "signature")
      try expect(sk, Int(crypto_sign_SECRETKEYBYTES), "secretKey")
      try succeed(
        crypto_sign_detached(bytes(sig), nil, bytes(message), UInt64(message.byteLength), bytes(sk)),
        "sign failed")
    }

    Function("crypto_kx_keypair") { (pk: Uint8Array, sk: Uint8Array) throws in
      try expect(pk, Int(crypto_kx_PUBLICKEYBYTES), "publicKey")
      try expect(sk, Int(crypto_kx_SECRETKEYBYTES), "secretKey")
      try succeed(crypto_kx_keypair(bytes(pk), bytes(sk)), "kx keypair failed")
    }

    Function("crypto_kx_seed_keypair") { (pk: Uint8Array, sk: Uint8Array, seed: Uint8Array) throws in
      try expect(pk, Int(crypto_kx_PUBLICKEYBYTES), "publicKey")
      try expect(sk, Int(crypto_kx_SECRETKEYBYTES), "secretKey")
      try expect(seed, Int(crypto_kx_SEEDBYTES), "seed")
      try succeed(crypto_kx_seed_keypair(bytes(pk), bytes(sk), bytes(seed)), "kx seed keypair failed")
    }

    Function("crypto_scalarmult") { (q: Uint8Array, n: Uint8Array, p: Uint8Array) throws in
      try expect(q, Int(crypto_scalarmult_BYTES), "output")
      try expect(n, Int(crypto_scalarmult_SCALARBYTES), "secretKey")
      try expect(p, Int(crypto_scalarmult_BYTES), "publicKey")
      try succeed(crypto_scalarmult(bytes(q), bytes(n), bytes(p)), "scalarmult failed")
    }

    Function("crypto_scalarmult_base") { (q: Uint8Array, n: Uint8Array) throws in
      try expect(q, Int(crypto_scalarmult_BYTES), "output")
      try expect(n, Int(crypto_scalarmult_SCALARBYTES), "secretKey")
      try succeed(crypto_scalarmult_base(bytes(q), bytes(n)), "scalarmult base failed")
    }

    Function("crypto_aead_chacha20poly1305_ietf_encrypt") {
      (c: Uint8Array, m: Uint8Array, ad: Uint8Array, npub: Uint8Array, k: Uint8Array) throws -> Int in
      try expect(c, m.byteLength + Int(crypto_aead_chacha20poly1305_ietf_ABYTES), "ciphertext")
      try expect(npub, Int(crypto_aead_chacha20poly1305_ietf_NPUBBYTES), "nonce")
      try expect(k, Int(crypto_aead_chacha20poly1305_ietf_KEYBYTES), "key")
      var written: UInt64 = 0
      try succeed(
        crypto_aead_chacha20poly1305_ietf_encrypt(
          bytes(c), &written, bytes(m), UInt64(m.byteLength), bytes(ad), UInt64(ad.byteLength),
          nil, bytes(npub), bytes(k)),
        "encrypt failed")
      return Int(written)
    }

    Function("crypto_aead_chacha20poly1305_ietf_decrypt") {
      (m: Uint8Array, c: Uint8Array, ad: Uint8Array, npub: Uint8Array, k: Uint8Array) throws -> Int in
      let abytes = Int(crypto_aead_chacha20poly1305_ietf_ABYTES)
      if c.byteLength < abytes { throw SodiumException("ciphertext is too short") }
      try expect(m, c.byteLength - abytes, "message")
      try expect(npub, Int(crypto_aead_chacha20poly1305_ietf_NPUBBYTES), "nonce")
      try expect(k, Int(crypto_aead_chacha20poly1305_ietf_KEYBYTES), "key")
      var written: UInt64 = 0
      try succeed(
        crypto_aead_chacha20poly1305_ietf_decrypt(
          bytes(m), &written, nil, bytes(c), UInt64(c.byteLength), bytes(ad), UInt64(ad.byteLength),
          bytes(npub), bytes(k)),
        "could not verify data")
      return Int(written)
    }

    // An empty `key` means unkeyed, as sodium-native's omitted key.
    Function("crypto_generichash") { (out: Uint8Array, input: Uint8Array, key: Uint8Array) throws in
      if out.byteLength < Int(crypto_generichash_BYTES_MIN) || out.byteLength > Int(crypto_generichash_BYTES_MAX) {
        throw SodiumException("hash output must be 16 to 64 bytes")
      }
      if key.byteLength != 0
        && (key.byteLength < Int(crypto_generichash_KEYBYTES_MIN) || key.byteLength > Int(crypto_generichash_KEYBYTES_MAX)) {
        throw SodiumException("hash key must be 16 to 64 bytes")
      }
      try succeed(
        crypto_generichash(
          bytes(out), out.byteLength, bytes(input), UInt64(input.byteLength),
          key.byteLength == 0 ? nil : bytes(key), key.byteLength),
        "generichash failed")
    }
  }
}
