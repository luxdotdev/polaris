// Approve, Always here and Deny on the Live Activity's takeover. The same type is in
// modules/polaris-live-activity, whose copy runs: iOS runs a LiveActivityIntent in the app.
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

  /// Never runs here: the app's copy does.
  func perform() async throws -> some IntentResult { .result() }
}
