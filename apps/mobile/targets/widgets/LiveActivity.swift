// The aggregate Live Activity, unstyled (LA1 draws it): what's working on every followed Host,
// or the oldest Needs You with its answers. docs/adr/0088.
import ActivityKit
import SwiftUI
import WidgetKit

struct LiveBody: View {
  let summary: LiveSummary

  var body: some View {
    if let (host, need) = summary.need {
      VStack(alignment: .leading) {
        Text("Needs you · \(host) · \(need.session)")
        Text(need.line)
        HStack {
          Link("Approve", destination: answer(need, "approve"))
          Link("Always here", destination: answer(need, "always"))
          Link("Deny", destination: answer(need, "deny"))
        }
        if summary.needs > 1 { Text("\(summary.needs - 1) more") }
      }
    } else {
      VStack(alignment: .leading) {
        HStack {
          Text("\(summary.working) working")
          if let since = summary.since { Text(since, style: .timer) }
        }
        if let (host, step) = summary.step {
          Text("\(host) · \(step.session)")
          Text(step.line)
        }
        if summary.unreadable > 0 { Text("Open Polaris to see every host") }
      }
    }
  }

  /// LA1 replaces these with LiveActivityIntent buttons that answer without opening the app.
  private func answer(_ need: LiveNeed, _ decision: String) -> URL {
    var url = URLComponents(string: "polaris://answer")!
    url.queryItems = [
      .init(name: "session", value: need.sessionId),
      .init(name: "request", value: need.requestId),
      .init(name: "decision", value: decision),
    ]
    return url.url!
  }
}

struct PolarisLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: PolarisActivityAttributes.self) { context in
      LiveBody(summary: LiveSummary(context.state)).padding()
    } dynamicIsland: { context in
      let summary = LiveSummary(context.state)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.bottom) { LiveBody(summary: summary) }
      } compactLeading: {
        Text("✦")
      } compactTrailing: {
        Text(summary.need == nil ? "\(summary.working)" : "!")
      } minimal: {
        Text(summary.need == nil ? "\(summary.working)" : "!")
      }
    }
  }
}
