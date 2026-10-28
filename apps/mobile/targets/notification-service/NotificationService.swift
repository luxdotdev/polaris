// Opens a sealed push (apps/daemon/src/push/README.md) with the device's push key and shows
// it. If anything fails, the generic alert APNs carried stays: it holds no content.
import CryptoKit
import UserNotifications

class NotificationService: UNNotificationServiceExtension {
  private var deliver: ((UNNotificationContent) -> Void)?
  private var content: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    let content =
      (request.content.mutableCopy() as? UNMutableNotificationContent)
      ?? UNMutableNotificationContent()
    deliver = contentHandler
    self.content = content

    if let sealed = request.content.userInfo["p"] as? String,
      let message = try? PushOpener.open(sealed)
    {
      show(message, in: content)
      RecentWakes.record(message)
    }
    contentHandler(content)
    deliver = nil
  }

  override func serviceExtensionTimeWillExpire() {
    if let deliver, let content { deliver(content) }
    deliver = nil
  }

  private func show(_ message: PushMessage, in content: UNMutableNotificationContent) {
    content.title = message.title
    content.subtitle = message.subtitle
    content.body = message.body
    content.threadIdentifier = message.sessionId
    content.categoryIdentifier = message.category ?? ""
    // The app reads these to answer: the sealed payload itself is dropped.
    var info = content.userInfo
    info.removeValue(forKey: "p")
    info["polaris"] = [
      "kind": message.kind,
      "hostId": message.hostId,
      "sessionId": message.sessionId,
      "constellationId": message.constellationId as Any,
      "requestId": message.requestId as Any,
    ]
    content.userInfo = info
  }
}
