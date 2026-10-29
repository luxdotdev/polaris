// The lock-screen widget (W1, inline) and the home-screen widget (W2, medium), on one timeline
// read from the App Group (Paper MX-AW and MX-AX); and the Live Activity (ADR 0088).
import SwiftUI
import WidgetKit

struct Entry: TimelineEntry {
  let date: Date
  let snapshot: WidgetSnapshot?
  /// The app's theme; the app reloads the timelines when it changes.
  let theme: PolarisTheme
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> Entry {
    Entry(date: .now, snapshot: nil, theme: PolarisTheme.current(UserDefaults(suiteName: appGroup)))
  }

  func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
    let defaults = UserDefaults(suiteName: appGroup)
    completion(
      Entry(date: .now, snapshot: loadSnapshot(defaults), theme: PolarisTheme.current(defaults)))
  }

  /// Ages tick on their own: an entry every five minutes for an hour, then read again. The app
  /// and the push extension reload sooner whenever something changes.
  func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
    let defaults = UserDefaults(suiteName: appGroup)
    let snapshot = loadSnapshot(defaults)
    let theme = PolarisTheme.current(defaults)
    let now = Date.now
    let entries = (0..<12).map { step in
      Entry(date: now.addingTimeInterval(Double(step) * 300), snapshot: snapshot, theme: theme)
    }
    completion(Timeline(entries: entries, policy: .atEnd))
  }
}

/// W1: "✦ 2 need you · 3 working" beside the lock-screen date, tinted by the system.
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
      HomeWidgetView(snapshot: entry.snapshot, date: entry.date, palette: entry.theme.palette)
        .containerBackground(entry.theme.palette.panel.color, for: .widget)
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
