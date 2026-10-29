// The app's half of the aggregate Live Activity (docs/adr/0088): start, update and end it, and
// report the tokens a Host's liveactivity pushes need.
import ActivityKit
import ExpoModulesCore
import Foundation

private func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }

@available(iOS 17.2, *)
private var current: Activity<PolarisActivityAttributes>? {
  Activity<PolarisActivityAttributes>.activities.first { $0.activityState == .active }
}

/// Every function is a no-op (or false) below iOS 17.2, where push-to-start and timestamps begin.
public class PolarisLiveActivityModule: Module {
  private var watching: Set<String> = []

  public func definition() -> ModuleDefinition {
    Name("PolarisLiveActivity")

    /// `pushToken {activityId, token}` per activity; `pushToStartToken {token}` per install;
    /// `answer` when the takeover's intent has an answer for `takeAnswers`.
    Events("pushToken", "pushToStartToken", "answer")

    OnStartObserving {
      guard #available(iOS 17.2, *) else { return }
      Task { [weak self] in
        for await token in Activity<PolarisActivityAttributes>.pushToStartTokenUpdates {
          self?.sendEvent("pushToStartToken", ["token": hex(token)])
        }
      }
      if let activity = current { self.watch(activity) }
      LiveAnswers.shared.onAnswer = { [weak self] in self?.sendEvent("answer", [:]) }
    }

    OnStopObserving {
      LiveAnswers.shared.onAnswer = nil
    }

    /// The takeover's answers not yet taken: `{hostId, sessionId, requestId, decision}`.
    Function("takeAnswers") { () -> [[String: String]] in LiveAnswers.shared.take() }

    /// Lets the intent that asked return: `id` is `<hostId>:<requestId>`.
    Function("answered") { (id: String) in LiveAnswers.shared.done(id) }

    Function("enabled") { () -> Bool in
      guard #available(iOS 17.2, *) else { return false }
      return ActivityAuthorizationInfo().areActivitiesEnabled
    }

    /// Starts the one activity (or adopts the live one) with each Host's slice JSON, sealed
    /// here; null below iOS 17.2 or before the push key exists.
    AsyncFunction("start") { (slices: [String]) -> String? in
      guard #available(iOS 17.2, *) else { return nil }
      if let activity = current { return activity.id }
      guard let state = try LiveSeal.state(slices) else { return nil }
      let activity = try Activity.request(
        attributes: PolarisActivityAttributes(),
        content: .init(state: state, staleDate: Date().addingTimeInterval(15 * 60)),
        pushType: .token
      )
      self.watch(activity)
      return activity.id
    }

    /// `timestamp` is Unix seconds: an update older than the one shown is dropped, push or not.
    AsyncFunction("update") { (slices: [String], timestamp: Double, alert: Bool) in
      guard #available(iOS 17.2, *), let activity = current, let state = try LiveSeal.state(slices) else {
        return
      }
      let alerting =
        alert ? AlertConfiguration(title: "Polaris", body: "An agent session needs you.", sound: .default) : nil
      await activity.update(
        .init(state: state, staleDate: Date().addingTimeInterval(15 * 60)),
        alertConfiguration: alerting,
        timestamp: Date(timeIntervalSince1970: timestamp)
      )
    }

    AsyncFunction("end") {
      guard #available(iOS 17.2, *) else { return }
      for activity in Activity<PolarisActivityAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }

    OnCreate {
      #if DEBUG
        if #available(iOS 17.2, *), ProcessInfo.processInfo.arguments.contains("-PolarisLiveActivityProbe") {
          LiveProbe.run()
        }
      #endif
    }
  }

  @available(iOS 17.2, *)
  private func watch(_ activity: Activity<PolarisActivityAttributes>) {
    guard watching.insert(activity.id).inserted else { return }
    Task { [weak self] in
      for await token in activity.pushTokenUpdates {
        self?.sendEvent("pushToken", ["activityId": activity.id, "token": hex(token)])
      }
    }
  }
}
