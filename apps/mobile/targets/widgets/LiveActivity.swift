// The aggregate Live Activity (docs/adr/0088): what's working on every followed Host, or the
// oldest Needs You with its answers. The lock screen follows the app's theme; the island is black.
import ActivityKit
import SwiftUI
import WidgetKit

struct PolarisLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: PolarisActivityAttributes.self) { context in
      let palette = PolarisTheme.current(UserDefaults(suiteName: appGroup)).palette
      LiveLockScreen(summary: LiveSummary(context.state), palette: palette)
        .activityBackgroundTint(palette.panel.color)
        .activitySystemActionForegroundColor(palette.textDefault.color)
        .widgetURL(URL(string: homeLink))
    } dynamicIsland: { context in
      let summary = LiveSummary(context.state)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.bottom) { LiveIslandExpanded(summary: summary) }
      } compactLeading: {
        LiveCompactLeading(summary: summary)
      } compactTrailing: {
        LiveCompactTrailing(summary: summary)
      } minimal: {
        LiveCompactLeading(summary: summary)
      }
      .widgetURL(URL(string: homeLink))
    }
  }
}
