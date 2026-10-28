// The iPhone Duo's posture for apps/mobile/src/duo: the hinge's status and angle
// (UIHingeInteraction) and the fold's division region, in the window's points.
import ExpoModulesCore
import UIKit

public class PolarisHingeModule: Module {
  private var probe: PostureProbe?

  public func definition() -> ModuleDefinition {
    Name("PolarisHinge")

    Events("onPosture")

    AsyncFunction("current") { () -> String in
      return PostureProbe.json(self.probe?.snapshot() ?? PostureProbe.snapshot(of: Self.window(), hinge: nil))
    }.runOnQueue(.main)

    OnStartObserving {
      DispatchQueue.main.async {
        guard self.probe == nil, let window = Self.window() else { return }
        self.probe = PostureProbe(window: window) { [weak self] posture in
          self?.sendEvent("onPosture", ["json": PostureProbe.json(posture)])
        }
      }
    }

    OnStopObserving {
      DispatchQueue.main.async {
        self.probe?.detach()
        self.probe = nil
      }
    }
  }

  static func window() -> UIWindow? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first(where: \.isKeyWindow)
  }
}

/// A zero-size view in the window: it carries the hinge interaction and hears the window resize.
final class PostureProbe: UIView {
  private let emit: ([String: Any]) -> Void
  private var hinge: [String: Any]?
  private var interaction: UIInteraction?
  private var last: NSDictionary?

  init(window: UIWindow, emit: @escaping ([String: Any]) -> Void) {
    self.emit = emit
    super.init(frame: window.bounds)
    isUserInteractionEnabled = false
    isHidden = true
    autoresizingMask = [.flexibleWidth, .flexibleHeight]
    window.addSubview(self)

    if #available(iOS 27.1, *) {
      let interaction = UIHingeInteraction { [weak self] _, update in
        self?.hinge = update.hinge.map(Self.describe)
        self?.publish()
      }
      addInteraction(interaction)
      self.interaction = interaction
    }
    publish()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("not decoded") }

  override func layoutSubviews() {
    super.layoutSubviews()
    publish()
  }

  func detach() {
    if let interaction { removeInteraction(interaction) }
    removeFromSuperview()
  }

  func snapshot() -> [String: Any] {
    Self.snapshot(of: window, hinge: hinge)
  }

  private func publish() {
    let next = snapshot()
    let dictionary = next as NSDictionary
    if last == dictionary { return }
    last = dictionary
    emit(next)
  }

  @available(iOS 27.1, *)
  private static func describe(_ hinge: UIHinge) -> [String: Any] {
    let status: String
    switch hinge.status {
    case .closed: status = "closed"
    case .partiallyOpen: status = "partiallyOpen"
    case .fullyOpen: status = "fullyOpen"
    default: status = "unknown"
    }
    return ["status": status, "angle": Double(hinge.angle) * 180 / .pi]
  }

  /// The report as JSON: apps/mobile/src/duo/usePosture.ts parses it with a Schema.
  static func json(_ report: [String: Any]) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: report) else { return "null" }
    return String(decoding: data, as: UTF8.self)
  }

  static func snapshot(of window: UIWindow?, hinge: [String: Any]?) -> [String: Any] {
    guard let window else { return ["hinge": NSNull(), "width": 0, "height": 0, "divisions": []] }
    var divisions: [[String: Double]] = []
    if #available(iOS 27.1, *) {
      divisions = window.reservedRegions(kind: .division).map { region in
        let frame = region.frame
        return [
          "x": Double(frame.origin.x), "y": Double(frame.origin.y),
          "width": Double(frame.size.width), "height": Double(frame.size.height),
        ]
      }
    }
    return [
      "hinge": hinge ?? NSNull(),
      "width": Double(window.bounds.width),
      "height": Double(window.bounds.height),
      "divisions": divisions,
    ]
  }
}
