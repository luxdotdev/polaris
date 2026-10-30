// Renders the Live Activity's views (targets/widgets/Live*.swift) to PNGs in both themes, for
// review without a lock screen: `bun scripts/liveRender.ts <out>` builds and runs it on a simulator.
import SwiftUI
import UIKit

let out = URL(fileURLWithPath: CommandLine.arguments[1])
let now = Date().timeIntervalSince1970

func step(_ session: String, _ line: String, harness: String? = "Claude Code") -> LiveLine {
  LiveLine(at: now - 20, sessionId: "s1", session: session, line: line, harness: harness)
}

func need(_ kind: String, harness: String? = "Claude Code") -> LiveNeed {
  LiveNeed(
    at: now - 60, sessionId: "s2", session: "Fix the relay reconnect backoff when the Mac sleeps mid-turn",
    line: "cargo build --release", harness: harness, requestId: "r1", kind: kind)
}

func slice(_ host: String, working: Int, step: LiveLine?, need: LiveNeed? = nil, celestials: [String]) -> HostSlice {
  HostSlice(
    v: 1, hostId: host, host: host, seq: 1, working: working, since: now - 18 * 60 - 4, step: step,
    need: need, needs: need == nil ? 0 : 2, celestials: celestials)
}

let working = LiveSummary(slices: [
  slice(
    "mac-studio", working: 2, step: step("Polaris planning", "Write apps/site/public/index.html"),
    celestials: ["claude/tilted-ring", "codex/twin-ring"]),
  slice("lucas-rpi", working: 1, step: nil, celestials: ["claude/banded"]),
  slice("linux-vm", working: 0, step: nil, celestials: []),
])

let takeover = LiveSummary(slices: [
  slice(
    "mac-studio", working: 2, step: step("Polaris planning", "Write apps/site/public/index.html"),
    need: need("approval"), celestials: ["claude/tilted-ring"]),
])

let question = LiveSummary(slices: [
  slice("mac-studio", working: 1, step: nil, need: need("question", harness: nil), celestials: [])
])

let unreadable = LiveSummary(slices: [
  slice("mac-studio", working: 1, step: step("Release 0.4.3", "Bash: bun test"), celestials: ["codex/storm"]),
  nil,
])

// break-ui: six hosts (MAX_LIVE_HOSTS), long titles, a long command, long host names.
let longTitle = "Migrate the billing reconciliation worker to the new ledger API and backfill Q3 2026"
let longCommand =
  "cd /Users/aleksandra.wisniewska-kowalczyk/Developer/northwind && bun run backfill --quarter 2026-Q3 --dry-run=false --timeout 600000"
let longHost = "aleksandra-wisniewska-kowalczyk-macbook-pro-16-northwind"

let worst = LiveSummary(slices: [
  slice(longHost, working: 12, step: step(longTitle, longCommand), celestials: ["claude/tilted-ring", "codex/twin-ring", "claude/banded"]),
  slice("build-farm-ubuntu-24-04-arm64-07", working: 3, step: step("A", "Bash: bun test"), celestials: ["codex/storm"]),
  slice("東京-render-farm-01", working: 1, step: nil, celestials: ["claude/banded"]),
  slice("Jo", working: 0, step: nil, celestials: []),
  slice("ci-runner-ephemeral-3f9c2a1b", working: 0, step: nil, celestials: []),
  slice("gpu-box", working: 1, step: nil, celestials: ["codex/twin-ring"]),
])

let worstTakeover = LiveSummary(slices: [
  slice(
    longHost, working: 12, step: step(longTitle, longCommand),
    need: LiveNeed(
      at: now - 60, sessionId: "s2", session: longTitle, line: longCommand, harness: "Claude Code",
      requestId: "r1", kind: "approval"),
    celestials: ["claude/tilted-ring"]),
] + Array(repeating: slice("gpu-box", working: 1, step: nil, celestials: []), count: 5))

/// The lock screen's card at the iPhone 17 Pro's width, on its wallpaper's night.
struct LockCard<Content: View>: View {
  let palette: ThemePalette
  @ViewBuilder let content: Content

  var body: some View {
    content
      .frame(width: 369, alignment: .leading)
      .background(palette.panel.color)
      .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
      .padding(12)
      .background(Color(red: 0.02, green: 0.03, blue: 0.09))
  }
}

/// The island on system black.
struct Island<Content: View>: View {
  let radius: CGFloat
  let width: CGFloat
  @ViewBuilder let content: Content

  var body: some View {
    content
      .padding(.horizontal, 20).padding(.vertical, 18)
      .frame(width: width, alignment: .leading)
      .background(Color.black, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
      .padding(12)
      .background(Color(red: 0.02, green: 0.03, blue: 0.09))
  }
}

@MainActor
func render<V: View>(_ name: String, _ view: V) {
  let renderer = ImageRenderer(content: view.environment(\.colorScheme, .dark))
  renderer.scale = 3
  guard let data = renderer.uiImage?.pngData() else {
    print("failed \(name)")
    return
  }
  try? data.write(to: out.appendingPathComponent("\(name).png"))
  print("wrote \(name)")
}

@MainActor
func main() {
  for theme in [PolarisTheme.midnight, .moonlit] {
    let palette = theme.palette
    render("lock-working-\(theme)", LockCard(palette: palette) { LiveLockScreen(summary: working, palette: palette) })
    render("lock-takeover-\(theme)", LockCard(palette: palette) { LiveLockScreen(summary: takeover, palette: palette) })
    render("lock-question-\(theme)", LockCard(palette: palette) { LiveLockScreen(summary: question, palette: palette) })
    render(
      "lock-unreadable-\(theme)", LockCard(palette: palette) { LiveLockScreen(summary: unreadable, palette: palette) })
    render("lock-worst-\(theme)", LockCard(palette: palette) { LiveLockScreen(summary: worst, palette: palette) })
    render(
      "lock-takeover-worst-\(theme)",
      LockCard(palette: palette) { LiveLockScreen(summary: worstTakeover, palette: palette) })
  }
  render(
    "island-compact-worst",
    HStack {
      LiveCompactLeading(summary: worstTakeover)
      Spacer()
      LiveCompactTrailing(summary: worstTakeover)
    }
    .padding(.horizontal, 14).frame(width: 230, height: 37)
    .background(Color.black, in: Capsule()).padding(12).background(Color(red: 0.02, green: 0.03, blue: 0.09)))
  render("island-expanded-worst", Island(radius: 44, width: 371) { LiveIslandExpanded(summary: worst) })
  render("island-takeover-worst", Island(radius: 44, width: 371) { LiveIslandExpanded(summary: worstTakeover) })
  render(
    "island-compact",
    HStack {
      LiveCompactLeading(summary: working)
      Spacer()
      LiveCompactTrailing(summary: working)
    }
    .padding(.horizontal, 14).frame(width: 230, height: 37)
    .background(Color.black, in: Capsule()).padding(12).background(Color(red: 0.02, green: 0.03, blue: 0.09)))
  render(
    "island-compact-needs-you",
    HStack {
      LiveCompactLeading(summary: takeover)
      Spacer()
      LiveCompactTrailing(summary: takeover)
    }
    .padding(.horizontal, 14).frame(width: 230, height: 37)
    .background(Color.black, in: Capsule()).padding(12).background(Color(red: 0.02, green: 0.03, blue: 0.09)))
  render("island-expanded", Island(radius: 44, width: 371) { LiveIslandExpanded(summary: working) })
  render("island-takeover", Island(radius: 44, width: 371) { LiveIslandExpanded(summary: takeover) })
}

MainActor.assumeIsolated { main() }
