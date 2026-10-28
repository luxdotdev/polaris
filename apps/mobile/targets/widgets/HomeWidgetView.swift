// W2's layout from Paper: the summary under the needs you mark, rows of glyph, title and age,
// and the horizon along the foot. Midnight's values (packages/ui/src/tokens/midnight.ts).
import SwiftUI
import WidgetKit

enum Palette {
  static let surface = Color(hex: 0x0A0B0D)
  static let textStrong = Color(hex: 0xF4F5F7)
  static let textSubtle = Color(hex: 0x9A9CA4)
  static let textFaint = Color(hex: 0x686A72)
  static let needsYou = Color(hex: 0xF2C84B)
  static let failed = Color(hex: 0xF37B72)
  static let starlight = Color(hex: 0xBCD3FF)

  static func tone(_ tone: String) -> Color {
    switch tone {
    case "needs-you": needsYou
    case "faint": textFaint
    default: textSubtle
    }
  }

  static func harness(_ kind: String) -> Color {
    switch kind {
    case "claude": Color(hex: 0xD97757)
    case "codex": Color(hex: 0x6FCBA0)
    case "opencode": Color(hex: 0xE58FA8)
    default: textSubtle
    }
  }
}

extension Color {
  init(hex: UInt32, alpha: Double = 1) {
    self.init(
      .sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255, opacity: alpha)
  }
}

struct HomeWidgetView: View {
  let entry: Entry

  var body: some View {
    ZStack(alignment: .bottom) {
      HorizonStrip(hour: Calendar.current.component(.hour, from: entry.date))
      VStack(alignment: .leading, spacing: 2) {
        header.padding(.bottom, 6)
        if let snapshot = entry.snapshot {
          ForEach(snapshot.rows, id: \.link) { row in
            Link(destination: URL(string: row.link) ?? URL(string: homeLink)!) {
              RowView(row: row, now: entry.date)
            }
          }
          .opacity(snapshot.stale ? 0.55 : 1)
          if let empty = snapshot.empty {
            Text(empty).font(.system(size: 13)).foregroundStyle(Palette.textSubtle)
          }
        } else {
          Text("Open Polaris to follow your agent sessions here")
            .font(.system(size: 13)).foregroundStyle(Palette.textSubtle)
        }
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 16)
      .padding(.top, 14)
    }
    .widgetURL(URL(string: entry.snapshot?.link ?? homeLink))
  }

  private var header: some View {
    HStack(spacing: 7) {
      StarMark().frame(width: 11, height: 11)
      summaryText.font(.system(size: 13)).lineLimit(1)
    }
  }

  private var summaryText: Text {
    guard let parts = entry.snapshot?.summary, let first = parts.first else {
      return Text("Polaris").foregroundStyle(Palette.textSubtle)
    }
    return parts.dropFirst().reduce(Text(first.text).foregroundStyle(Palette.tone(first.tone))) {
      line, part in
      line + Text(" · ").foregroundStyle(Palette.textSubtle)
        + Text(part.text).foregroundStyle(Palette.tone(part.tone))
    }
  }
}

struct RowView: View {
  let row: WidgetRow
  let now: Date

  var body: some View {
    HStack(spacing: 10) {
      Glyph(row: row).frame(width: 14, height: 20)
      Text(row.title)
        .font(.system(size: 15, weight: .medium)).foregroundStyle(Palette.textStrong)
        .lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
      Text(trailing(row, now: now))
        .font(.system(size: 13)).monospacedDigit()
        .foregroundStyle(trailingColor)
    }
    .frame(height: 30)
  }

  private var trailingColor: Color {
    switch row.glyph {
    case "needs-you": Palette.needsYou
    case "working", "starting": Palette.textSubtle
    default: Palette.textFaint
    }
  }
}
