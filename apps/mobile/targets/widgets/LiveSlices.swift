// Opens each Host's sealed slice with the push key (HPKE, info "polaris-live/1", as
// apps/daemon/src/push/live.ts seals) and folds them into what the activity shows.
import CryptoKit
import Foundation

struct LiveLine: Decodable {
  let at: Double
  let sessionId: String
  let session: String
  let line: String
}

struct LiveNeed: Decodable {
  let at: Double
  let sessionId: String
  let session: String
  let line: String
  let requestId: String
  let kind: String
}

struct HostSlice: Decodable {
  let v: Int
  let hostId: String
  let host: String
  let seq: Double
  let working: Int
  let since: Double?
  let step: LiveLine?
  let need: LiveNeed?
  let needs: Int
}

/// Matches modules/polaris-push: the same group, service and account.
enum LiveKeychain {
  static func load() -> P256.KeyAgreement.PrivateKey? {
    var item: CFTypeRef?
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "dev.lux.polaris.push",
      kSecAttrAccount as String: "push-key/1",
      kSecAttrAccessGroup as String: "HWD6374DUX.dev.lux.polaris.shared",
      kSecReturnData as String: true,
    ]
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let data = item as? Data
    else { return nil }
    return try? P256.KeyAgreement.PrivateKey(rawRepresentation: data)
  }
}

func openSlice(_ sealed: String, key: P256.KeyAgreement.PrivateKey) -> HostSlice? {
  var base64 = sealed.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
  base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
  guard let bytes = Data(base64Encoded: base64), bytes.count > 65,
    var recipient = try? HPKE.Recipient(
      privateKey: key, ciphersuite: .P256_SHA256_AES_GCM_256,
      info: Data("polaris-live/1".utf8), encapsulatedKey: bytes.prefix(65)),
    let plain = try? recipient.open(bytes.dropFirst(65), authenticating: Data()),
    let slice = try? JSONDecoder().decode(HostSlice.self, from: plain), slice.v == 1
  else { return nil }
  return slice
}

/// Every Host folded: total working, the longest-running Turn, the newest step, the oldest need.
struct LiveSummary {
  var working = 0
  var since: Date?
  var step: (host: String, line: LiveLine)?
  var need: (host: String, need: LiveNeed)?
  var needs = 0
  var unreadable = 0

  init(_ state: PolarisActivityAttributes.ContentState) {
    let key = LiveKeychain.load()
    for sealed in state.slices {
      guard let key, let slice = openSlice(sealed, key: key) else {
        unreadable += 1
        continue
      }
      add(slice)
    }
    #if DEBUG
      NSLog(
        "POLARIS_LIVE render working=%d needs=%d unreadable=%d step=%@ need=%@", working, needs, unreadable,
        step.map { "\($0.host) \($0.line.line)" } ?? "-", need.map { "\($0.host) \($0.need.line)" } ?? "-")
    #endif
  }

  private mutating func add(_ slice: HostSlice) {
    working += slice.working
    needs += slice.needs
    if let started = slice.since.map({ Date(timeIntervalSince1970: $0) }), since.map({ started < $0 }) ?? true {
      since = started
    }
    if let line = slice.step, step.map({ line.at > $0.line.at }) ?? true {
      step = (slice.host, line)
    }
    if let open = slice.need, need.map({ open.at < $0.need.at }) ?? true {
      need = (slice.host, open)
    }
  }
}
