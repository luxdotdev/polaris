// The lock-screen widget (W1, inline) and the home-screen widget (W2, medium), on one timeline
// read from the App Group (Paper "Mobile" page, W1 and W2); and the Live Activity (ADR 0088).
import SwiftUI
import WidgetKit

struct Entry: TimelineEntry {
  let date: Date
  let snapshot: WidgetSnapshot?
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> Entry { Entry(date: .now, snapshot: nil) }

  func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
    completion(Entry(date: .now, snapshot: loadSnapshot(UserDefaults(suiteName: appGroup))))
  }

  /// Ages tick on their own: an entry every five minutes for an hour, then read again. The app
  /// and the push extension reload sooner whenever something changes.
  func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
    let snapshot = loadSnapshot(UserDefaults(suiteName: appGroup))
    let now = Date.now
    let entries = (0..<12).map { step in
      Entry(date: now.addingTimeInterval(Double(step) * 300), snapshot: snapshot)
    }
    completion(Timeline(entries: entries, policy: .atEnd))
  }
}

/// W1: "✦ 2 need you · 3 working" above the clock.
struct InlineWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "PolarisInline", provider: Provider()) { entry in
      Text("✦ " + inlineLine(entry.snapshot))
        .widgetURL(URL(string: entry.snapshot?.link ?? homeLink))
        .containerBackground(.clear, for: .widget)
    }
    .configurationDisplayName("Polaris")
    .description("What needs you and what's working.")
    .supportedFamilies([.accessoryInline])
  }
}

func inlineLine(_ snapshot: WidgetSnapshot?) -> String {
  guard let snapshot else { return "Polaris" }
  return snapshot.summary.map(\.text).joined(separator: " · ")
}

/// W2: the summary, the top three agent sessions and the horizon.
struct HomeWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "PolarisHome", provider: Provider()) { entry in
      HomeWidgetView(entry: entry)
        .containerBackground(Palette.surface, for: .widget)
    }
    .configurationDisplayName("Agent sessions")
    .description("What needs you first, then what's working.")
    .supportedFamilies([.systemMedium])
    .contentMarginsDisabled()
  }
}

@main
struct PolarisWidgets: WidgetBundle {
  var body: some Widget {
    InlineWidget()
    HomeWidget()
    PolarisLiveActivity()
  }
}
