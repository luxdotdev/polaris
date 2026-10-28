// The app's half of push (apps/daemon/src/push/README.md): the P-256 push key, kept in the
// Keychain group the Notification Service Extension shares, and the APNs environment.
import CryptoKit
import ExpoModulesCore
import UIKit

/// Matches targets/notification-service/PushKeychain.swift: the same group, service and account.
private enum PushKeychain {
  static let group = "HWD6374DUX.dev.lux.polaris.shared"
  static let service = "dev.lux.polaris.push"
  static let account = "push-key/1"

  static func query() -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrAccessGroup as String: group,
    ]
  }

  static func load() throws -> P256.KeyAgreement.PrivateKey? {
    var item: CFTypeRef?
    var lookup = query()
    lookup[kSecReturnData as String] = true
    let status = SecItemCopyMatching(lookup as CFDictionary, &item)

    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = item as? Data else {
      throw Exception(name: "PushKeyUnavailable", description: "Keychain read failed: \(status)")
    }
    return try P256.KeyAgreement.PrivateKey(rawRepresentation: data)
  }

  static func store(_ key: P256.KeyAgreement.PrivateKey) throws {
    SecItemDelete(query() as CFDictionary)
    var item = query()
    item[kSecValueData as String] = key.rawRepresentation
    // The extension decrypts while the phone is locked, so not WhenUnlocked.
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = SecItemAdd(item as CFDictionary, nil)

    guard status == errSecSuccess else {
      throw Exception(name: "PushKeyUnavailable", description: "Keychain write failed: \(status)")
    }
  }
}

private func base64Url(_ data: Data) -> String {
  data.base64EncodedString()
    .replacingOccurrences(of: "+", with: "-")
    .replacingOccurrences(of: "/", with: "_")
    .replacingOccurrences(of: "=", with: "")
}

/// The provisioning profile's aps-environment: no profile (the App Store) is production.
private func apnsEnvironment() -> String {
  #if targetEnvironment(simulator)
    return "sandbox"
  #else
    guard
      let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
      let data = try? Data(contentsOf: url),
      let text = String(data: data, encoding: .isoLatin1),
      let start = text.range(of: "<plist"),
      let end = text.range(of: "</plist>"),
      let plist = try? PropertyListSerialization.propertyList(
        from: Data(text[start.lowerBound..<end.upperBound].utf8), format: nil
      ) as? [String: Any],
      let entitlements = plist["Entitlements"] as? [String: Any],
      let environment = entitlements["aps-environment"] as? String
    else { return "production" }
    return environment == "development" ? "sandbox" : "production"
  #endif
}

public class PolarisPushModule: Module {
  private var tasks: [String: UIBackgroundTaskIdentifier] = [:]

  public func definition() -> ModuleDefinition {
    Name("PolarisPush")

    /// The push key's public half (X9.63, base64url); made on first use.
    AsyncFunction("pushKey") { () -> String in
      let key = try PushKeychain.load() ?? {
        let made = P256.KeyAgreement.PrivateKey()
        try PushKeychain.store(made)
        return made
      }()
      return base64Url(key.publicKey.x963Representation)
    }

    /// A new key; the old one can no longer open anything sealed to it.
    AsyncFunction("rotatePushKey") { () -> String in
      let made = P256.KeyAgreement.PrivateKey()
      try PushKeychain.store(made)
      return base64Url(made.publicKey.x963Representation)
    }

    Function("apnsEnvironment") { () -> String in apnsEnvironment() }

    /// Keeps the app running while it answers from the lock screen; iOS ends it after ~30 s.
    AsyncFunction("beginAnswer") { (id: String) in
      await MainActor.run {
        self.tasks[id] = UIApplication.shared.beginBackgroundTask(withName: "polaris-answer") {
          self.finish(id)
        }
      }
    }

    AsyncFunction("endAnswer") { (id: String) in
      await MainActor.run { self.finish(id) }
    }
  }

  @MainActor private func finish(_ id: String) {
    guard let task = tasks.removeValue(forKey: id) else { return }
    UIApplication.shared.endBackgroundTask(task)
  }
}
