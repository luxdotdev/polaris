// Long-press menus for apps/mobile/src/menus: a UIContextMenuInteraction around React Native
// children, lifting the view itself as the preview, and UIPasteboard for the Copy items.
import ExpoModulesCore
import UIKit

public class PolarisContextMenuModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PolarisContextMenu")

    AsyncFunction("copy") { (text: String) in
      UIPasteboard.general.string = text
    }.runOnQueue(.main)

    View(PolarisContextMenuView.self) {
      Events("onSelectItem")

      Prop("menu") { (view: PolarisContextMenuView, json: String) in
        view.setMenu(json)
      }

      Prop("previewColor") { (view: PolarisContextMenuView, color: UIColor?) in
        view.previewColor = color
      }

      Prop("previewRadius") { (view: PolarisContextMenuView, radius: Double?) in
        view.previewRadius = CGFloat(radius ?? 12)
      }
    }
  }
}

/// One item as `src/menus/LongPressMenu.tsx` encodes it.
struct ContextMenuItem: Decodable {
  let id: String
  let title: String
  let subtitle: String?
  let disabled: Bool
}

final class PolarisContextMenuView: ExpoView, UIContextMenuInteractionDelegate {
  let onSelectItem = EventDispatcher()
  var previewColor: UIColor?
  var previewRadius: CGFloat = 12
  private var sections: [[ContextMenuItem]] = []

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    addInteraction(UIContextMenuInteraction(delegate: self))
  }

  func setMenu(_ json: String) {
    let decoded = json.data(using: .utf8).flatMap {
      try? JSONDecoder().decode([[ContextMenuItem]].self, from: $0)
    }
    sections = (decoded ?? []).filter { !$0.isEmpty }
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    configurationForMenuAtLocation location: CGPoint
  ) -> UIContextMenuConfiguration? {
    // No items: no menu, and the long press stays the row's own.
    guard !sections.isEmpty else { return nil }

    return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { [weak self] _ in
      self?.menu()
    }
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    configuration: UIContextMenuConfiguration,
    highlightPreviewForItemWithIdentifier identifier: any NSCopying
  ) -> UITargetedPreview? {
    preview()
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    configuration: UIContextMenuConfiguration,
    dismissalPreviewForItemWithIdentifier identifier: any NSCopying
  ) -> UITargetedPreview? {
    preview()
  }

  /// The row itself, lifted on the screen's ground with rounded corners.
  private func preview() -> UITargetedPreview? {
    guard window != nil else { return nil }
    let parameters = UIPreviewParameters()
    parameters.backgroundColor = previewColor ?? .black
    parameters.visiblePath = UIBezierPath(roundedRect: bounds, cornerRadius: previewRadius)

    return UITargetedPreview(view: self, parameters: parameters)
  }

  private func menu() -> UIMenu {
    // Each section is an inline group: iOS draws the separators between them.
    let groups = sections.map { items in
      UIMenu(title: "", options: .displayInline, children: items.map(action))
    }

    return UIMenu(title: "", children: groups)
  }

  private func action(_ item: ContextMenuItem) -> UIAction {
    let attributes: UIMenuElement.Attributes = item.disabled ? [.disabled] : []

    let action = UIAction(title: item.title, attributes: attributes) { [weak self] _ in
      self?.onSelectItem(["id": item.id])
    }
    action.subtitle = item.subtitle

    return action
  }
}
