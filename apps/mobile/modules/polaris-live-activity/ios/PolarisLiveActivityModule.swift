// The app's half of the aggregate Live Activity (docs/adr/0088): start, update and end it, and
// report the tokens a Host's liveactivity pushes need.
import ActivityKit
import ExpoModulesCore
import Foundation

private func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }

@available(iOS 17.2, *)
private func decodeState(_ json: String) throws -> PolarisActivityAttributes.ContentState {
  try JSONDecoder().decode(PolarisActivityAttributes.ContentState.self, from: Data(json.utf8))
}

@available(iOS 17.2, *)
private var current: Activity<PolarisActivityAttributes>? {
  Activity<PolarisActivityAttributes>.activities.first { $0.activityState == .active }
}

/// Every function is a no-op (or false) below iOS 17.2, where push-to-start and timestamps begin.
public class PolarisLiveActivityModule: Module {
  private var watching: Set<String> = []

  public func definition() -> ModuleDefinition {
    Name("PolarisLiveActivity")

    /// `pushToken {activityId, token}` per activity; `pushToStartToken {token}` per install.
    Events("pushToken", "pushToStartToken")

    OnStartObserving {
      guard #available(iOS 17.2, *) else { return }
      Task { [weak self] in
        for await token in Activity<PolarisActivityAttributes>.pushToStartTokenUpdates {
          self?.sendEvent("pushToStartToken", ["token": hex(token)])
        }
      }
      if let activity = current { self.watch(activity) }
    }

    Function("enabled") { () -> Bool in
      guard #available(iOS 17.2, *) else { return false }
      return ActivityAuthorizationInfo().areActivitiesEnabled
    }

    /// Starts the one activity (or adopts the live one) with `state` as ContentState JSON.
    AsyncFunction("start") { (state: String) -> String? in
      guard #available(iOS 17.2, *) else { return nil }
      if let activity = current { return activity.id }
      let activity = try Activity.request(
        attributes: PolarisActivityAttributes(),
        content: .init(state: try decodeState(state), staleDate: nil),
        pushType: .token
      )
      self.watch(activity)
      return activity.id
    }

    /// `timestamp` is Unix seconds: an update older than the one shown is dropped, push or not.
    AsyncFunction("update") { (state: String, timestamp: Double, alert: Bool) in
      guard #available(iOS 17.2, *), let activity = current else { return }
      let alerting =
        alert ? AlertConfiguration(title: "Polaris", body: "An agent session needs you.", sound: .default) : nil
      await activity.update(
        .init(state: try decodeState(state), staleDate: nil),
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
