// The horizon strip along W2's foot (Paper W2): the ridge from Home's horizon, lit for the hour
// as `glowFor` in apps/mobile/src/home/ui/Horizon.tsx, with three stars.
import SwiftUI

/// Paper W2's ridge on its 364-wide strip: [to x, top y] steps from x = 0.
private let ridge: [(CGFloat, CGFloat)] = [
  (28, 20), (46, 18), (60, 16), (70, 14), (86, 16), (108, 18), (162, 20), (176, 18), (184, 16),
  (190, 12), (196, 10), (200, 12), (216, 16), (244, 18), (272, 20), (298, 18), (310, 16),
  (324, 14), (338, 16), (364, 18),
]

private struct Ridge: Shape {
  let drop: CGFloat

  func path(in rect: CGRect) -> Path {
    let scale = rect.width / 364
    var path = Path()
    var x: CGFloat = 0
    path.move(to: CGPoint(x: 0, y: rect.maxY))
    for (to, top) in ridge {
      path.addLine(to: CGPoint(x: x * scale, y: top + drop))
      path.addLine(to: CGPoint(x: to * scale, y: top + drop))
      x = to
    }
    path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
    path.closeSubpath()
    return path
  }
}

/// Core and halo by hour: blue at night, warm at dawn and dusk, pale by day.
func glow(hour: Int) -> (core: Color, halo: Color) {
  switch hour {
  case 5..<8: (Color(hex: 0xE1A078, alpha: 0.34), Color(hex: 0xA56546, alpha: 0.15))
  case 8..<17: (Color(hex: 0x9DB8E8, alpha: 0.24), Color(hex: 0x5F7FB8, alpha: 0.10))
  case 17..<20: (Color(hex: 0xC98A9A, alpha: 0.30), Color(hex: 0x7A4A6A, alpha: 0.12))
  default: (Color(hex: 0x7896E1, alpha: 0.34), Color(hex: 0x465FA5, alpha: 0.12))
  }
}

struct HorizonStrip: View {
  let hour: Int

  var body: some View {
    let light = glow(hour: hour)
    GeometryReader { geometry in
      let scale = geometry.size.width / 364
      ZStack(alignment: .topLeading) {
        EllipticalGradient(
          colors: [light.core, light.halo, .clear], center: UnitPoint(x: 0.5, y: 0.6),
          startRadiusFraction: 0, endRadiusFraction: 0.5)
        Ridge(drop: 0).fill(Color(hex: 0x22305A))
        Ridge(drop: 2).fill(Palette.surface)
        Rectangle().fill(Palette.starlight.opacity(0.5)).frame(width: 2, height: 2)
          .offset(x: 52 * scale, y: 6)
        Rectangle().fill(Color.white.opacity(0.35)).frame(width: 2, height: 2)
          .offset(x: 236 * scale, y: 4)
        Rectangle().fill(Palette.starlight.opacity(0.4)).frame(width: 2, height: 2)
          .offset(x: 318 * scale, y: 8)
      }
    }
    .frame(height: 28)
    .clipped()
  }
}
