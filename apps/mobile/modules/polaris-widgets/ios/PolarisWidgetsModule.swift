// The app's side of the widgets: apps/mobile/src/widgets/publish.ts writes the snapshot through
// this module into the App Group, then asks WidgetKit to redraw.
import ExpoModulesCore
import WidgetKit

public class PolarisWidgetsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PolarisWidgets")

    Function("write") { (suite: String, key: String, json: String) in
      UserDefaults(suiteName: suite)?.set(json, forKey: key)
    }

    Function("reload") {
      WidgetCenter.shared.reloadAllTimelines()
    }
  }
}
