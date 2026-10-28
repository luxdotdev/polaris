// The widgets' pixel glyphs, from Paper W2 and Home's (apps/mobile/src/home/ui/glyphs.tsx): the
// needs you hand, a still Working dither in the Harness's hue, and done's dot.
import SwiftUI

/// Rects on a grid of `size` cells, drawn at the frame's size.
struct Pixels: View {
  let size: CGFloat
  let rects: [(CGFloat, CGFloat, CGFloat, CGFloat, Double)]
  let color: Color

  var body: some View {
    Canvas { context, canvas in
      let unit = min(canvas.width, canvas.height) / size
      let origin = CGPoint(
        x: (canvas.width - unit * size) / 2, y: (canvas.height - unit * size) / 2)
      for (x, y, w, h, alpha) in rects {
        context.fill(
          Path(
            CGRect(x: origin.x + x * unit, y: origin.y + y * unit, width: w * unit, height: h * unit)),
          with: .color(color.opacity(alpha)))
      }
    }
  }
}

/// A 2-wide square-capped stroke in the hand's 24 grid, as `stroke` in glyphs.tsx.
private func stroke(_ x1: CGFloat, _ y1: CGFloat, _ x2: CGFloat, _ y2: CGFloat) -> (
  CGFloat, CGFloat, CGFloat, CGFloat, Double
) {
  (min(x1, x2) - 1, min(y1, y2) - 1, abs(x2 - x1) + 2, abs(y2 - y1) + 2, 1)
}

private let hand = [
  stroke(19, 21, 19, 7), stroke(16, 10, 16, 5), stroke(16, 5, 17, 5), stroke(13, 10, 13, 3),
  stroke(13, 3, 14, 3), stroke(10, 10, 10, 1), stroke(10, 1, 11, 1), stroke(7, 12, 7, 3),
  stroke(7, 3, 10, 3), stroke(4, 10, 4, 16), stroke(6, 18, 6, 18), stroke(8, 20, 8, 21),
]

/// Paper W2's 12-point dither, still: widgets don't animate.
private let dither: [(CGFloat, CGFloat, CGFloat, CGFloat, Double)] = [
  (0, 0, 2, 2, 1), (4, 0, 2, 2, 0.5), (8, 0, 2, 2, 1), (2, 2, 2, 2, 0.6), (6, 2, 2, 2, 1),
  (10, 2, 2, 2, 0.4), (0, 4, 2, 2, 0.5), (4, 4, 2, 2, 1), (8, 4, 2, 2, 0.7), (2, 6, 2, 2, 1),
  (6, 6, 2, 2, 0.5), (10, 6, 2, 2, 1), (0, 8, 2, 2, 0.7), (4, 8, 2, 2, 0.4), (8, 8, 2, 2, 1),
  (2, 10, 2, 2, 0.5), (6, 10, 2, 2, 1), (10, 10, 2, 2, 0.6),
]

struct Glyph: View {
  let row: WidgetRow

  var body: some View {
    switch row.glyph {
    case "needs-you":
      Pixels(size: 24, rects: hand, color: Palette.needsYou).frame(width: 20, height: 20)
    case "working", "starting":
      Pixels(size: 12, rects: dither, color: Palette.harness(row.harness))
        .frame(width: 12, height: 12)
        .opacity(row.glyph == "starting" ? 0.6 : 1)
    case "failed":
      Circle().fill(Palette.failed).frame(width: 6, height: 6)
    default:
      Circle().fill(Palette.textFaint).frame(width: 6, height: 6)
    }
  }
}

/// The needs you section's star: Starlight arms around a full core.
struct StarMark: View {
  var body: some View {
    Pixels(
      size: 10, rects: [(4, 0, 2, 10, 0.7), (0, 4, 10, 2, 0.7), (3, 3, 4, 4, 1)],
      color: Palette.starlight)
  }
}
