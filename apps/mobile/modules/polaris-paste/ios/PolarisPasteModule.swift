// Images pasted into a composer (apps/mobile/src/composer/usePastedImages.ts); paste.ts parses
// the JSON report. RN's text views paste only text, so Paste is extended for watched fields.
import ExpoModulesCore
import ObjectiveC
import UIKit
import UniformTypeIdentifiers

public class PolarisPasteModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PolarisPaste")

    Events("onPaste")

    OnCreate {
      PasteHook.module = self
      DispatchQueue.main.async { PasteHook.install() }
    }

    /// The field with this `nativeID` takes pasted images; counted, so each watch needs an unwatch.
    AsyncFunction("watch") { (fieldId: String) in
      PasteHook.watched[fieldId, default: 0] += 1
    }.runOnQueue(.main)

    AsyncFunction("unwatch") { (fieldId: String) in
      let count = (PasteHook.watched[fieldId] ?? 0) - 1
      PasteHook.watched[fieldId] = count > 0 ? count : nil
    }.runOnQueue(.main)
  }

  fileprivate func emit(_ body: [String: Any]) {
    sendEvent("onPaste", body)
  }
}

/// One image from the pasteboard, as the bytes written to disk.
private struct PastedImage {
  let data: Data
  let ext: String
  let mimeType: String
}

/// Hooks `paste:` and `canPerformAction:withSender:` on RN's backed text views. Main thread only.
enum PasteHook {
  fileprivate static weak var module: PolarisPasteModule?
  static var watched: [String: Int] = [:]
  private static var installed = false

  private static let pasteSelector = #selector(UIResponderStandardEditActions.paste(_:))
  private static let canSelector = #selector(UIResponder.canPerformAction(_:withSender:))

  static func install() {
    if installed { return }
    installed = true
    for name in ["RCTUITextView", "RCTUITextField"] {
      if let cls = NSClassFromString(name) { hook(cls) }
    }
  }

  /// The class's own method; added first when only a superclass has it, so UIKit's stays as it is.
  private static func ownMethod(_ cls: AnyClass, _ selector: Selector) -> Method? {
    guard let inherited = class_getInstanceMethod(cls, selector) else { return nil }
    class_addMethod(
      cls, selector, method_getImplementation(inherited), method_getTypeEncoding(inherited))
    return class_getInstanceMethod(cls, selector)
  }

  private static func hook(_ cls: AnyClass) {
    guard let canMethod = ownMethod(cls, canSelector),
      let pasteMethod = ownMethod(cls, pasteSelector)
    else { return }

    typealias CanFn = @convention(c) (AnyObject, Selector, Selector, AnyObject?) -> Bool
    typealias PasteFn = @convention(c) (AnyObject, Selector, AnyObject?) -> Void
    let originalCan = unsafeBitCast(method_getImplementation(canMethod), to: CanFn.self)
    let originalPaste = unsafeBitCast(method_getImplementation(pasteMethod), to: PasteFn.self)

    let can: @convention(block) (AnyObject, Selector, AnyObject?) -> Bool = { this, action, sender in
      if originalCan(this, canSelector, action, sender) { return true }
      return action == pasteSelector && fieldTakingImages(this) != nil
    }

    let paste: @convention(block) (AnyObject, AnyObject?) -> Void = { this, sender in
      guard let fieldId = fieldTakingImages(this) else {
        originalPaste(this, pasteSelector, sender)
        return
      }
      let board = UIPasteboard.general
      if board.hasStrings || board.hasURLs { originalPaste(this, pasteSelector, sender) }
      let items = board.items
      DispatchQueue.global(qos: .userInitiated).async { write(items, for: fieldId) }
    }

    method_setImplementation(canMethod, imp_implementationWithBlock(can))
    method_setImplementation(pasteMethod, imp_implementationWithBlock(paste))
  }

  /// The watched field this text view belongs to, when it is editable and images wait to be pasted.
  private static func fieldTakingImages(_ object: AnyObject) -> String? {
    guard let view = object as? UIView, editable(view), UIPasteboard.general.hasImages,
      let fieldId = nativeId(of: view), watched[fieldId] != nil
    else { return nil }
    return fieldId
  }

  private static func editable(_ view: UIView) -> Bool {
    let hidden = NSSelectorFromString("contextMenuHidden")
    if view.responds(to: hidden), (view.value(forKey: "contextMenuHidden") as? Bool) == true {
      return false
    }
    if let text = view as? UITextView { return text.isEditable }
    if let field = view as? UITextField { return field.isEnabled }
    return false
  }

  /// The `nativeID` of the TextInput's component view, the text view's nearest ancestors.
  private static func nativeId(of view: UIView) -> String? {
    let selector = NSSelectorFromString("nativeId")
    var current: UIView? = view
    for _ in 0..<3 {
      guard let candidate = current else { return nil }
      if candidate.responds(to: selector), let id = candidate.value(forKey: "nativeId") as? String,
        !id.isEmpty
      {
        return id
      }
      current = candidate.superview
    }
    return nil
  }

  /// Each item's image as PNG or JPEG: kept as copied when it already is one, else re-encoded.
  private static func image(in item: [String: Any]) -> PastedImage? {
    let keys = [UTType.png.identifier, UTType.jpeg.identifier]
      + item.keys.filter { UTType($0)?.conforms(to: .image) == true }.sorted()
    guard let key = keys.first(where: { item[$0] != nil }), let value = item[key] else {
      return nil
    }
    if let data = value as? Data, key == UTType.png.identifier {
      return PastedImage(data: data, ext: "png", mimeType: "image/png")
    }
    if let data = value as? Data, key == UTType.jpeg.identifier {
      return PastedImage(data: data, ext: "jpg", mimeType: "image/jpeg")
    }
    guard let image = (value as? UIImage) ?? (value as? Data).flatMap(UIImage.init(data:)) else {
      return nil
    }
    if hasAlpha(image), let png = image.pngData() {
      return PastedImage(data: png, ext: "png", mimeType: "image/png")
    }
    return image.jpegData(compressionQuality: 0.9).map {
      PastedImage(data: $0, ext: "jpg", mimeType: "image/jpeg")
    }
  }

  private static func hasAlpha(_ image: UIImage) -> Bool {
    switch image.cgImage?.alphaInfo {
    case .first, .last, .premultipliedFirst, .premultipliedLast: return true
    default: return false
    }
  }

  private static func write(_ items: [[String: Any]], for fieldId: String) {
    let folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("polaris-paste", isDirectory: true)
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

    var images: [[String: Any]] = []
    for item in items {
      guard let pasted = image(in: item) else { continue }
      let url = folder.appendingPathComponent("\(UUID().uuidString).\(pasted.ext)")
      guard (try? pasted.data.write(to: url, options: .atomic)) != nil else { continue }
      images.append([
        "uri": url.absoluteString,
        "name": "pasted-\(images.count + 1).\(pasted.ext)",
        "mimeType": pasted.mimeType,
        "size": pasted.data.count,
      ])
    }
    let report: [String: Any] = ["fieldId": fieldId, "images": images]
    guard !images.isEmpty, let json = try? JSONSerialization.data(withJSONObject: report) else {
      return
    }
    let text = String(decoding: json, as: UTF8.self)
    DispatchQueue.main.async { module?.emit(["json": text]) }
  }
}
