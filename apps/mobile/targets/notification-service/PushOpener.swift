// HPKE base mode, DHKEM(P-256, HKDF-SHA256) / HKDF-SHA256 / AES-256-GCM, info "polaris-push/1",
// as apps/daemon/src/push/seal.ts seals; the sealed form is base64url of enc ‖ ciphertext.
import CryptoKit
import Foundation

struct PushMessage: Decodable {
  let v: Int
  let kind: String
  let hostId: String
  let hostName: String
  let sessionId: String
  let requestId: String?
  let category: String?
  let title: String
  let subtitle: String
  let body: String
  let at: String
}

enum PushOpenError: Error {
  case malformed
  case noKey
  case keychain(OSStatus)
}

/// Matches modules/polaris-push/ios/PolarisPushModule.swift: the same group, service and account.
enum PushKeychain {
  static let group = "HWD6374DUX.dev.lux.polaris.shared"
  static let service = "dev.lux.polaris.push"
  static let account = "push-key/1"

  static func load() throws -> P256.KeyAgreement.PrivateKey {
    var item: CFTypeRef?
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrAccessGroup as String: group,
      kSecReturnData as String: true,
    ]
    let status = SecItemCopyMatching(query as CFDictionary, &item)

    if status == errSecItemNotFound { throw PushOpenError.noKey }
    guard status == errSecSuccess, let data = item as? Data else {
      throw PushOpenError.keychain(status)
    }
    return try P256.KeyAgreement.PrivateKey(rawRepresentation: data)
  }
}

enum PushOpener {
  static let info = Data("polaris-push/1".utf8)
  static let encBytes = 65

  static func open(_ sealed: String, key: P256.KeyAgreement.PrivateKey? = nil) throws -> PushMessage {
    guard let bytes = base64UrlDecode(sealed), bytes.count > encBytes else {
      throw PushOpenError.malformed
    }
    var recipient = try HPKE.Recipient(
      privateKey: key ?? PushKeychain.load(),
      ciphersuite: .P256_SHA256_AES_GCM_256,
      info: info,
      encapsulatedKey: bytes.prefix(encBytes)
    )
    let plain = try recipient.open(bytes.dropFirst(encBytes), authenticating: Data())
    let message = try JSONDecoder().decode(PushMessage.self, from: plain)

    guard message.v == 1 else { throw PushOpenError.malformed }
    return message
  }

  static func base64UrlDecode(_ text: String) -> Data? {
    var base64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
    return Data(base64Encoded: base64)
  }
}
