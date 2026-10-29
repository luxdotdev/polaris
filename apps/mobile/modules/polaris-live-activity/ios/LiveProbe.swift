// Debug only: `simctl launch … -PolarisLiveActivityProbe` seals two Hosts' slices the way the
// Daemon does, then starts, updates and takes over the activity, logging `POLARIS_LIVE …`.
#if DEBUG
  import ActivityKit
  import CryptoKit
  import Foundation

  @available(iOS 17.2, *)
  enum LiveProbe {
    private static let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "dev.lux.polaris.push",
      kSecAttrAccount as String: "push-key/1",
      kSecAttrAccessGroup as String: "HWD6374DUX.dev.lux.polaris.shared",
    ]

    /// The push key polaris-push keeps, made the same way when this install has none yet.
    private static func pushKey() throws -> P256.KeyAgreement.PrivateKey {
      var item: CFTypeRef?
      var lookup = query
      lookup[kSecReturnData as String] = true
      if SecItemCopyMatching(lookup as CFDictionary, &item) == errSecSuccess, let data = item as? Data {
        return try P256.KeyAgreement.PrivateKey(rawRepresentation: data)
      }
      let made = P256.KeyAgreement.PrivateKey()
      var add = query
      add[kSecValueData as String] = made.rawRepresentation
      add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      SecItemAdd(add as CFDictionary, nil)
      return made
    }

    private static func seal(_ slice: [String: Any], to key: P256.KeyAgreement.PublicKey) throws -> String {
      var sender = try HPKE.Sender(
        recipientKey: key, ciphersuite: .P256_SHA256_AES_GCM_256, info: Data("polaris-live/1".utf8))
      let plain = try JSONSerialization.data(withJSONObject: slice)
      let sealed = sender.encapsulatedKey + (try sender.seal(plain, authenticating: Data()))
      return sealed.base64EncodedString()
        .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
    }

    private static func slice(_ host: String, seq: Int, working: Int, step: String, need: Bool) -> [String: Any] {
      let now = Date().timeIntervalSince1970
      return [
        "v": 1, "hostId": host, "host": host, "seq": seq, "working": working,
        "since": working > 0 ? now - 125 : NSNull(),
        "step": ["at": now + Double(seq), "sessionId": "\(host)-s1", "session": "Fix the relay reconnect", "line": step],
        "need": need
          ? ["at": now, "sessionId": "\(host)-s2", "session": "Release 0.4.3", "line": "Bash: git push origin main",
             "requestId": "r1", "kind": "approval"] as [String: Any]
          : NSNull(),
        "needs": need ? 1 : 0,
      ]
    }

    private static func state(_ slices: [[String: Any]], _ key: P256.KeyAgreement.PublicKey) throws -> PolarisActivityAttributes.ContentState {
      .init(v: 1, slices: try slices.map { try seal($0, to: key) })
    }

    static func run() {
      Task {
        do {
          let key = try pushKey().publicKey
          NSLog("POLARIS_LIVE enabled=%@", ActivityAuthorizationInfo().areActivitiesEnabled ? "yes" : "no")
          let activity = try Activity.request(
            attributes: PolarisActivityAttributes(),
            content: .init(state: try state([
              slice("studio", seq: 1, working: 2, step: "Edit apps/relay/src/hub.ts", need: false),
              slice("lucas-rpi", seq: 1, working: 1, step: "Bash: bun test", need: false),
            ], key), staleDate: nil),
            pushType: .token)
          NSLog("POLARIS_LIVE started id=%@", activity.id)
          Task {
            for await token in activity.pushTokenUpdates {
              NSLog("POLARIS_LIVE pushToken=%@", token.map { String(format: "%02x", $0) }.joined())
            }
          }
          try await Task.sleep(for: .seconds(8))
          await activity.update(.init(state: try state([
            slice("studio", seq: 2, working: 2, step: "Read packages/protocol/src/relay/wire.ts", need: false),
            slice("lucas-rpi", seq: 1, working: 1, step: "Bash: bun test", need: false),
          ], key), staleDate: nil))
          NSLog("POLARIS_LIVE updated step")
          try await Task.sleep(for: .seconds(8))
          await activity.update(.init(state: try state([
            slice("studio", seq: 3, working: 1, step: "Read packages/protocol/src/relay/wire.ts", need: true),
            slice("lucas-rpi", seq: 1, working: 1, step: "Bash: bun test", need: false),
          ], key), staleDate: nil))
          NSLog("POLARIS_LIVE updated needs-you")
        } catch {
          NSLog("POLARIS_LIVE failed %@", String(describing: error))
        }
      }
    }
  }
#endif
