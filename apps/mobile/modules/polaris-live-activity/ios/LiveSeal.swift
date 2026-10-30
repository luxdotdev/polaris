// Seals the app's own slices to this device's push key, as the Daemon does (apps/daemon/src/push/
// live.ts), so app-driven updates draw the same as pushed ones (docs/adr/0088).
import CryptoKit
import Foundation

/// Matches modules/polaris-push: the same group, service and account.
enum LiveSeal {
  static func key() -> P256.KeyAgreement.PublicKey? {
    var item: CFTypeRef?
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "dev.lux.polaris.push",
      kSecAttrAccount as String: "push-key/1",
      kSecAttrAccessGroup as String: "HWD6374DUX.dev.lux.polaris.shared",
      kSecReturnData as String: true,
    ]
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else {
      return nil
    }
    return (try? P256.KeyAgreement.PrivateKey(rawRepresentation: data))?.publicKey
  }

  @available(iOS 17.0, *)
  static func seal(_ slice: String, to key: P256.KeyAgreement.PublicKey) throws -> String {
    var sender = try HPKE.Sender(
      recipientKey: key, ciphersuite: .P256_SHA256_AES_GCM_256, info: Data("polaris-live/1".utf8))
    let sealed = sender.encapsulatedKey + (try sender.seal(Data(slice.utf8), authenticating: Data()))
    return sealed.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  /// Each slice's JSON sealed; nil without a push key (not linked yet).
  @available(iOS 17.2, *)
  static func state(_ slices: [String]) throws -> PolarisActivityAttributes.ContentState? {
    guard let key = key() else { return nil }
    return .init(v: 1, slices: try slices.map { try seal($0, to: key) })
  }
}
