// Opens each Host's sealed slice with the push key (HPKE, info "polaris-live/1", as
// apps/daemon/src/push/live.ts seals) and folds them into what the activity shows.
import CryptoKit
import Foundation
import os

struct LiveLine: Decodable {
  let at: Double
  let sessionId: String
  let session: String
  let line: String
  /// The Harness by name ("Claude Code"); absent from older Hosts or cut to fit.
  let harness: String?
}

struct LiveNeed: Decodable {
  let at: Double
  let sessionId: String
  let session: String
  let line: String
  let harness: String?
  let requestId: String
  let kind: String
}

/// A working session's celestial: `<harness kind>/<body>`.
struct LiveCelestial: Equatable {
  let harness: String
  let body: String

  init?(_ text: String) {
    let parts = text.split(separator: "/", maxSplits: 1).map(String.init)
    guard parts.count == 2 else { return nil }
    harness = parts[0]
    body = parts[1]
  }
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
  let celestials: [String]?
}

/// Why the activity couldn't open a slice, in Release with no content (docs/adr/0090).
let liveLog = Logger(subsystem: "dev.lux.polaris.widgets", category: "live")

/// Matches modules/polaris-push: the same group, service and account, then its App Group copy.
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
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecSuccess, let data = item as? Data,
      let key = try? P256.KeyAgreement.PrivateKey(rawRepresentation: data)
    {
      return key
    }
    liveLog.error("push key: Keychain read failed, status \(status, privacy: .public)")
    return fileKey()
  }

  /// The copy modules/polaris-push keeps in the App Group container.
  static func fileKey() -> P256.KeyAgreement.PrivateKey? {
    guard
      let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.dev.lux.polaris")?
        .appendingPathComponent("push-key-1")
    else {
      liveLog.error("push key: no App Group container")
      return nil
    }
    do {
      return try P256.KeyAgreement.PrivateKey(rawRepresentation: Data(contentsOf: url))
    } catch {
      liveLog.error("push key: App Group copy unreadable: \(String(describing: error), privacy: .public)")
      return nil
    }
  }
}

/// Where opening a slice stopped.
enum LiveOpenFailure: Error, Equatable {
  case malformed
  case open
  /// The failing field's path and kind, never its value.
  case decode(String)
  case version(Int)
}

private func describe(_ error: DecodingError) -> String {
  let path = { (context: DecodingError.Context) in
    context.codingPath.map(\.stringValue).joined(separator: ".")
  }
  switch error {
  case .keyNotFound(let key, let context): return "missing \(path(context)).\(key.stringValue)"
  case .typeMismatch(_, let context): return "type mismatch at \(path(context))"
  case .valueNotFound(_, let context): return "null at \(path(context))"
  case .dataCorrupted(let context): return "not JSON at \(path(context))"
  @unknown default: return "unknown"
  }
}

func tryOpenSlice(_ sealed: String, key: P256.KeyAgreement.PrivateKey) -> Result<HostSlice, LiveOpenFailure> {
  var base64 = sealed.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
  base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
  guard let bytes = Data(base64Encoded: base64), bytes.count > 65 else { return .failure(.malformed) }
  guard
    var recipient = try? HPKE.Recipient(
      privateKey: key, ciphersuite: .P256_SHA256_AES_GCM_256,
      info: Data("polaris-live/1".utf8), encapsulatedKey: bytes.prefix(65)),
    let plain = try? recipient.open(bytes.dropFirst(65), authenticating: Data())
  else { return .failure(.open) }
  do {
    let slice = try JSONDecoder().decode(HostSlice.self, from: plain)
    return slice.v == 1 ? .success(slice) : .failure(.version(slice.v))
  } catch let error as DecodingError {
    return .failure(.decode(describe(error)))
  } catch {
    return .failure(.decode("unknown"))
  }
}

/// The slice, or nil with the reason logged.
func openSlice(_ sealed: String, key: P256.KeyAgreement.PrivateKey) -> HostSlice? {
  switch tryOpenSlice(sealed, key: key) {
  case .success(let slice): return slice
  case .failure(let failure):
    liveLog.error("slice not opened: \(String(describing: failure), privacy: .public)")
    return nil
  }
}

/// What the activity draws at most of the working sessions' celestials.
let liveCelestialLimit = 3

/// Every Host folded: total working, the longest-running Turn, the newest step, the oldest need.
struct LiveSummary {
  var hosts = 0
  var working = 0
  var since: Date?
  var step: (hostId: String, host: String, line: LiveLine)?
  var need: (hostId: String, host: String, need: LiveNeed)?
  var needs = 0
  var celestials: [LiveCelestial] = []
  var unreadable = 0

  /// Opens every slice with the push key from the shared Keychain.
  init(_ state: PolarisActivityAttributes.ContentState) {
    let key = LiveKeychain.load()
    self.init(slices: state.slices.map { sealed in key.flatMap { openSlice(sealed, key: $0) } })
    #if DEBUG
      NSLog(
        "POLARIS_LIVE render working=%d needs=%d unreadable=%d step=%@ need=%@", working, needs, unreadable,
        step.map { "\($0.host) \($0.line.line)" } ?? "-", need.map { "\($0.host) \($0.need.line)" } ?? "-")
    #endif
  }

  /// `nil` for a slice that couldn't be opened.
  init(slices: [HostSlice?]) {
    for slice in slices {
      guard let slice else {
        unreadable += 1
        continue
      }
      add(slice)
    }
  }

  private mutating func add(_ slice: HostSlice) {
    hosts += 1
    working += slice.working
    needs += slice.needs
    if let started = slice.since.map({ Date(timeIntervalSince1970: $0) }), since.map({ started < $0 }) ?? true {
      since = started
    }
    if let line = slice.step, step.map({ line.at > $0.line.at }) ?? true {
      step = (slice.hostId, slice.host, line)
    }
    if let open = slice.need, need.map({ open.at < $0.need.at }) ?? true {
      need = (slice.hostId, slice.host, open)
    }
    let room = liveCelestialLimit - celestials.count
    celestials += (slice.celestials ?? []).compactMap(LiveCelestial.init).prefix(max(0, room))
  }
}
