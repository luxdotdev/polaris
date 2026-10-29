// The aggregate Live Activity's type (docs/adr/0088). Kept identical in
// modules/polaris-live-activity: ActivityKit and APNs' attributes-type match it by name.
import ActivityKit

struct PolarisActivityAttributes: ActivityAttributes {
  /// Each followed Host's latest slice, sealed to this device (apps/daemon/src/push/live.ts).
  struct ContentState: Codable, Hashable {
    var v: Int
    var slices: [String]
  }
}
