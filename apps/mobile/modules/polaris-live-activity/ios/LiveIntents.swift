// Approve, Always here and Deny on the Live Activity's takeover. The same type as
// targets/widgets/LiveIntents.swift; iOS runs this copy, in the app, and JS sends the answer.
import AppIntents
import Foundation

enum LiveDecision: String, AppEnum {
  case approve
  case always
  case deny

  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Answer"
  static let caseDisplayRepresentations: [LiveDecision: DisplayRepresentation] = [
    .approve: "Approve", .always: "Always here", .deny: "Deny",
  ]
}

struct LiveAnswerIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Answer an agent session"
  static let isDiscoverable = false
  /// As the notification's actions: Face ID or the passcode first.
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  @Parameter(title: "Host") var hostId: String
  @Parameter(title: "Session") var sessionId: String
  @Parameter(title: "Request") var requestId: String
  @Parameter(title: "Answer") var decision: LiveDecision

  init() {}

  init(hostId: String, sessionId: String, requestId: String, decision: LiveDecision) {
    self.hostId = hostId
    self.sessionId = sessionId
    self.requestId = requestId
    self.decision = decision
  }

  /// Hands the answer to JS and waits, within the intent's background time, until it was sent.
  func perform() async throws -> some IntentResult {
    await LiveAnswers.shared.submit([
      "hostId": hostId, "sessionId": sessionId, "requestId": requestId, "decision": decision.rawValue,
    ])
    return .result()
  }
}

/// Answers from the intent waiting for JS: JS takes them (`takeAnswers`) and reports each sent.
final class LiveAnswers: @unchecked Sendable {
  static let shared = LiveAnswers()
  /// Within an intent's ~30 s, as ANSWER_WAIT_MS in src/push/deliver.ts.
  static let waitSeconds: UInt64 = 25

  private let lock = NSLock()
  private var unclaimed: [[String: String]] = []
  private var waiting: [String: [CheckedContinuation<Void, Never>]] = [:]
  /// Set by the module while JS listens: nudges it to take the new answer.
  var onAnswer: (() -> Void)?

  static func id(_ answer: [String: String]) -> String {
    "\(answer["hostId"] ?? ""):\(answer["requestId"] ?? "")"
  }

  func submit(_ answer: [String: String]) async {
    let id = Self.id(answer)
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      lock.lock()
      unclaimed.append(answer)
      waiting[id, default: []].append(continuation)
      let nudge = onAnswer
      lock.unlock()
      nudge?()
      Task {
        try? await Task.sleep(nanoseconds: Self.waitSeconds * 1_000_000_000)
        self.done(id)
      }
    }
  }

  func take() -> [[String: String]] {
    lock.lock()
    defer { lock.unlock() }
    let taken = unclaimed
    unclaimed = []
    return taken
  }

  /// Sent, or given up on: the intent returns either way.
  func done(_ id: String) {
    lock.lock()
    let resumed = waiting.removeValue(forKey: id) ?? []
    lock.unlock()
    resumed.forEach { $0.resume() }
  }
}
