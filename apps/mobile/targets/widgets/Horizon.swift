// The horizon strip along W2's foot (Paper MX-AX): the near ridge of the home screen's horizon,
// cut to the widget, in the theme's far-ridge colour.
import SwiftUI

/// MX-AX's ridge in its 393-wide scene: [to x, top y] steps from x = 0, tops in the 44pt strip.
private let ridge: [(CGFloat, CGFloat)] = [
  (12, 28), (20, 26), (28, 30), (36, 28), (44, 30), (60, 32), (68, 34), (84, 36), (92, 32),
  (100, 28), (116, 30), (132, 26), (140, 28), (148, 26), (156, 24), (164, 26), (172, 24),
  (188, 22), (212, 26), (228, 30), (236, 32), (244, 30), (252, 32), (276, 36), (292, 32),
  (300, 36), (316, 34), (324, 32), (332, 34), (372, 36), (380, 34), (388, 32), (393, 28),
]

/// The widget sits 24pt into the scene and is 345pt wide there.
private let sceneInset: CGFloat = 24
private let sceneWidth: CGFloat = 345

private struct Ridge: Shape {
  func path(in rect: CGRect) -> Path {
    let scale = rect.width / sceneWidth
    let x = { (scene: CGFloat) in (scene - sceneInset) * scale }
    var path = Path()
    var from: CGFloat = 0
    path.move(to: CGPoint(x: x(0), y: rect.maxY))
    for (to, top) in ridge {
      path.addLine(to: CGPoint(x: x(from), y: top))
      path.addLine(to: CGPoint(x: x(to), y: top))
      from = to
    }
    path.addLine(to: CGPoint(x: x(from), y: rect.maxY))
    path.closeSubpath()
    return path
  }
}

struct HorizonStrip: View {
  let palette: ThemePalette

  var body: some View {
    Ridge().fill(palette.ridgeBack.color).frame(height: 44).clipped()
  }
}
