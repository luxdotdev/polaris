// Opens sealed slices with targets/widgets/LiveSlices.swift and prints one result per slice, for
// apps/daemon/src/push/live.widget.test.ts. argv[1] is the raw P-256 private key, base64url.
import CryptoKit
import Foundation

/// ActivityKit's type isn't on macOS; LiveSlices.swift only needs its shape.
struct PolarisActivityAttributes {
  struct ContentState { var v: Int; var slices: [String] }
}

func bytes(_ base64url: String) -> Data {
  var base64 = base64url.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
  base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
  return Data(base64Encoded: base64) ?? Data()
}

let key = try P256.KeyAgreement.PrivateKey(rawRepresentation: bytes(CommandLine.arguments[1]))
let results: [[String: Any]] = CommandLine.arguments.dropFirst(2).map { sealed in
  switch tryOpenSlice(sealed, key: key) {
  case .failure(let failure): return ["failure": String(describing: failure)]
  case .success(let slice):
    return [
      "host": slice.host,
      "working": slice.working,
      "step": slice.step.map { "\($0.harness ?? "-") \($0.session): \($0.line)" } ?? NSNull(),
      "need": slice.need.map { "\($0.kind) \($0.requestId): \($0.line)" } ?? NSNull(),
      "celestials": slice.celestials ?? [],
    ]
  }
}
print(String(data: try JSONSerialization.data(withJSONObject: results, options: [.sortedKeys]), encoding: .utf8)!)
