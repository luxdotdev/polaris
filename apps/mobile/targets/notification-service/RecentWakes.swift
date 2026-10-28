// The widget hook (apps/mobile/README.md: Push): each opened push is kept in the App Group, and
// every widget timeline reloads. No bodies are kept; S7's widgets read what is here.
import Foundation
import WidgetKit

struct RecentWake: Codable {
  let kind: String
  let hostId: String
  let hostName: String
  let sessionId: String
  let requestId: String?
  let subtitle: String
  let at: String
}

enum RecentWakes {
  static let suite = "group.dev.lux.polaris"
  static let key = "polaris.push.recent"
  static let limit = 20

  static func record(_ message: PushMessage) {
    guard let defaults = UserDefaults(suiteName: suite) else { return }
    var recent = read(defaults)
    recent.insert(
      RecentWake(
        kind: message.kind, hostId: message.hostId, hostName: message.hostName,
        sessionId: message.sessionId, requestId: message.requestId,
        subtitle: message.subtitle, at: message.at),
      at: 0)
    if let data = try? JSONEncoder().encode(Array(recent.prefix(limit))) {
      defaults.set(data, forKey: key)
    }
    WidgetCenter.shared.reloadAllTimelines()
  }

  static func read(_ defaults: UserDefaults) -> [RecentWake] {
    guard let data = defaults.data(forKey: key) else { return [] }
    return (try? JSONDecoder().decode([RecentWake].self, from: data)) ?? []
  }
}
