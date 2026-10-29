// The widgets' glyphs, from Paper MX-AX: needs you's four-point star (NeedsYouStar in
// apps/mobile/src/home/ui/glyphs.tsx), a dot in the Harness's hue while working, and done's dot.
import SwiftUI

/// A closed polygon on a square grid of `size` units, drawn at the frame's size.
struct GridShape: Shape {
  let size: CGFloat
  let points: [(CGFloat, CGFloat)]

  func path(in rect: CGRect) -> Path {
    let unit = min(rect.width, rect.height) / size
    let origin = CGPoint(x: rect.midX - unit * size / 2, y: rect.midY - unit * size / 2)
    var path = Path()
    path.addLines(points.map { CGPoint(x: origin.x + $0.0 * unit, y: origin.y + $0.1 * unit) })
    path.closeSubpath()
    return path
  }
}

/// A four-point star centred on a `size` grid, its arms `arm` from the centre and its waist `waist`.
private func fourPoint(size: CGFloat, arm: CGFloat, waist: CGFloat) -> GridShape {
  let c = size / 2
  return GridShape(
    size: size,
    points: [
      (c, c - arm), (c + waist, c - waist), (c + arm, c), (c + waist, c + waist), (c, c + arm),
      (c - waist, c + waist), (c - arm, c), (c - waist, c - waist),
    ])
}

struct Glyph: View {
  let row: WidgetRow
  let palette: ThemePalette

  var body: some View {
    switch row.glyph {
    case "needs-you":
      fourPoint(size: 12, arm: 5.5, waist: 1.1).fill(palette.needsYou.color)
        .frame(width: 12, height: 12)
    case "working", "starting":
      Circle().fill(palette.harness(row.harness).color).frame(width: 8, height: 8)
        .opacity(row.glyph == "starting" ? 0.5 : 1)
    case "failed":
      Circle().fill(palette.failed.color).frame(width: 6, height: 6)
    default:
      Circle().fill(palette.textFaint.color).frame(width: 6, height: 6)
    }
  }
}

/// The summary's mark: the app icon's star, a pale blue outer star round a Starlight one.
struct StarMark: View {
  let palette: ThemePalette

  var body: some View {
    ZStack {
      fourPoint(size: 16, arm: 8, waist: 1.4).fill(ThemeColour(0x7C9FE8).color)
      fourPoint(size: 16, arm: 5, waist: 0.9).fill(palette.starlight.color)
      Circle().fill(Color.white).scaleEffect(2.8 / 16)
    }
  }
}

extension ThemePalette {
  /// A Harness's hue, as `harnessHue` in apps/mobile/src/home/ui/rowLook.ts; unknown is neutral.
  func harness(_ kind: String) -> ThemeColour {
    switch kind {
    case "claude": harnessClaudeCode
    case "codex": harnessCodex
    case "opencode": harnessOpencode
    default: textSubtle
    }
  }
}
