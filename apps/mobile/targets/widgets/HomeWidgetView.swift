// W2's layout from Paper MX-AX: the summary under the needs you mark, rows of glyph, title and age
// or turn, and the horizon along the foot, in the app's theme (Theme.swift).
import SwiftUI
import WidgetKit

struct HomeWidgetView: View {
  let snapshot: WidgetSnapshot?
  let date: Date
  let palette: ThemePalette
  /// Off only for scripts/widgetsDriver/render.swift: ImageRenderer can't draw a Link.
  var linked = true

  var body: some View {
    ZStack(alignment: .bottom) {
      HorizonStrip(palette: palette)
      VStack(alignment: .leading, spacing: 2) {
        header.padding(.bottom, 6)
        if let snapshot {
          ForEach(snapshot.rows, id: \.link) { row in
            if linked {
              Link(destination: URL(string: row.link) ?? URL(string: homeLink)!) {
                RowView(row: row, now: date, palette: palette)
              }
            } else {
              RowView(row: row, now: date, palette: palette)
            }
          }
          .opacity(snapshot.stale ? 0.55 : 1)
          if let empty = snapshot.empty {
            Text(empty).font(.system(size: 13)).foregroundStyle(palette.textSubtle.color)
          }
        } else {
          Text("Open Polaris to follow your agent sessions here")
            .font(.system(size: 13)).foregroundStyle(palette.textSubtle.color)
        }
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 16)
      .padding(.top, 14)
    }
    .widgetURL(URL(string: snapshot?.link ?? homeLink))
  }

  private var header: some View {
    HStack(spacing: 7) {
      StarMark(palette: palette).frame(width: 11, height: 11)
      summaryText.font(.system(size: 13)).lineLimit(1)
    }
  }

  private var summaryText: Text {
    guard let parts = snapshot?.summary, let first = parts.first else {
      return Text("Polaris").foregroundStyle(palette.textSubtle.color)
    }
    return parts.dropFirst().reduce(Text(first.text).foregroundStyle(tone(first.tone))) {
      line, part in
      line + Text(" · ").foregroundStyle(palette.textSubtle.color)
        + Text(part.text).foregroundStyle(tone(part.tone))
    }
  }

  private func tone(_ tone: String) -> Color {
    switch tone {
    case "needs-you": palette.needsYouText.color
    case "faint": palette.textFaint.color
    default: palette.textSubtle.color
    }
  }
}

struct RowView: View {
  let row: WidgetRow
  let now: Date
  let palette: ThemePalette

  var body: some View {
    HStack(spacing: 10) {
      Glyph(row: row, palette: palette).frame(width: 14, height: 20)
      Text(row.title)
        .font(.system(size: 15, weight: .medium)).foregroundStyle(palette.textStrong.color)
        .lineLimit(1).truncationMode(.tail).frame(maxWidth: .infinity, alignment: .leading)
      Text(trailing(row, now: now))
        .font(.system(size: 13)).monospacedDigit()
        .foregroundStyle(trailingColor)
    }
    .frame(height: 30)
  }

  private var trailingColor: Color {
    switch row.glyph {
    case "needs-you": palette.needsYouText.color
    case "working", "starting": palette.textSubtle.color
    default: palette.textFaint.color
    }
  }
}
