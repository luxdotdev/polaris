// Renders W2 (targets/widgets/HomeWidgetView.swift) on macOS with MX-AX's sessions, as the
// home screen would: argv[1] the theme, argv[2] a PNG path or "-" to print sampled pixels as JSON,
// argv[3] optionally "worst" or "empty" for break-ui's data.
import AppKit
import SwiftUI

let theme = PolarisTheme(rawValue: CommandLine.arguments[1]) ?? .midnight
let output = CommandLine.arguments[2]
let palette = theme.palette
let now = Date(timeIntervalSince1970: 1_793_300_000)
let millis = now.timeIntervalSince1970 * 1000

func row(_ id: String, _ title: String, _ glyph: String, minutes: Double, turn: Int?) -> WidgetRow {
  WidgetRow(
    hostId: "studio", sessionId: id, title: title, harness: "claude", glyph: glyph, turn: turn,
    since: millis - minutes * 60_000, link: sessionLink(hostId: "studio", sessionId: id))
}

let demo = WidgetSnapshot(
  version: snapshotVersion, needsYou: 2, working: 3,
  summary: [
    SummaryPart(text: "2 need you", tone: "needs-you"), SummaryPart(text: "3 working", tone: "subtle"),
  ],
  rows: [
    row("a", "Fix the relay reconnect backoff when the Mac sleeps mid-turn", "needs-you", minutes: 2,
      turn: nil),
    row("b", "Spike GPUI review screen", "needs-you", minutes: 42, turn: nil),
    row("c", "Polaris planning", "working", minutes: 18, turn: 24),
  ],
  empty: nil, stale: false, link: homeLink, writtenAt: millis)

let worst = WidgetSnapshot(
  version: snapshotVersion, needsYou: 128, working: 1284,
  summary: [
    SummaryPart(text: "128 need you", tone: "needs-you"), SummaryPart(text: "1,284 working", tone: "subtle"),
  ],
  rows: [
    row("a", "Migrate the billing reconciliation worker to the new ledger API and backfill Q3 2026", "needs-you",
      minutes: 60 * 24 * 400, turn: nil),
    row("b", "A", "working", minutes: 0, turn: 1284),
    row("c", "東京のレンダーファームでアニメーションの書き出しが失敗する件を調べる", "failed", minutes: 59, turn: 99999),
  ],
  empty: nil, stale: true, link: homeLink, writtenAt: millis - 3 * 86_400_000)

let empty = WidgetSnapshot(
  version: snapshotVersion, needsYou: 0, working: 0, summary: [], rows: [],
  empty: "Link this iPhone from Polaris on your Mac", stale: false, link: homeLink, writtenAt: millis)

let dataset = CommandLine.arguments.count > 3 ? CommandLine.arguments[3] : "demo"
let snapshot = dataset == "worst" ? worst : dataset == "empty" ? empty : demo

let size = CGSize(width: 345, height: 162)

@MainActor func render() -> CGImage? {
  let view = HomeWidgetView(snapshot: snapshot, date: now, palette: palette, linked: false)
    .frame(width: size.width, height: size.height)
    .background(palette.panel.color)
    .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    .environment(\.colorScheme, .dark)
  let renderer = ImageRenderer(content: view)
  renderer.scale = output == "-" ? 1 : 3
  return renderer.cgImage
}

/// The pixel at (x, y) in points of a 1x render, as lowercase #rrggbb.
func pixel(_ image: CGImage, _ x: Int, _ y: Int) -> String {
  // The image is sRGB already; AppKit tags its pixels calibrated RGB, so read them unconverted.
  guard let colour = NSBitmapImageRep(cgImage: image).colorAt(x: x, y: y) else { return "none" }
  let channels = [colour.redComponent, colour.greenComponent, colour.blueComponent]
  return "#" + channels.map { String(format: "%02x", Int(($0 * 255).rounded())) }.joined()
}

@main
enum Render {
  @MainActor static func main() {
    guard let image = render() else { fatalError("nothing rendered") }
    if output == "-" {
      // The ridge's foot, mid-width.
      let samples = ["ridge": pixel(image, 172, 158)]
      print(String(data: try! JSONEncoder().encode(samples), encoding: .utf8)!)
    } else {
      let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])!
      try! png.write(to: URL(fileURLWithPath: output))
    }
  }
}
