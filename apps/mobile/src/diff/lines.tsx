/**
 * Diff lines as Paper MX-Q and MX-R draw them: a gutter sized for two digits (wider only when
 * the file's numbers are), the sign, and soft-wrapped code with its changed tokens filled.
 */
import { mobileType } from "@polaris/ui/tokens";
import { memo } from "react";
import { type StyleProp, Text, type TextStyle, View } from "react-native";
import type { Line, LineKind } from "../review/diffRows.ts";
import type { DiffPalette } from "../review/palette.ts";
import { themedStyles, useTheme } from "../theme/index.ts";
import { CONTENT_TEXT_SCALE } from "../theme/textScale.ts";
import { type Span, segments } from "./align.ts";

/** JetBrains Mono's advance at 12pt, for a gutter that fits its numbers exactly. */
const DIGIT_WIDTH = 7.2;

/** The gutter's width for numbers up to `largest`: never under two digits. */
export const gutterWidth = (largest: number): number =>
  Math.ceil(Math.max(2, String(largest).length) * DIGIT_WIDTH) + 1;

const SIGN: Readonly<Record<LineKind, string>> = { context: " ", add: "+", remove: "-" };

export const lineFill = (palette: DiffPalette, kind: LineKind): string | undefined => {
  if (kind === "add") return palette.addedBg;

  return kind === "remove" ? palette.removedBg : undefined;
};

/** The code of one line, its emphasised tokens filled; it wraps instead of scrolling sideways. */
export const CodeText = memo(function CodeText({
  text,
  emphasis,
  kind,
  palette,
  style,
}: {
  readonly text: string;
  readonly emphasis: ReadonlyArray<Span>;
  readonly kind: LineKind;
  readonly palette: DiffPalette;
  /** Another list's code style in place of MX-Q's 12/19 mono. */
  readonly style?: StyleProp<TextStyle>;
}) {
  const styles = useStyles();
  const { colours } = useTheme();

  const colour = {
    context: colours.textDefault,
    add: palette.addedText,
    remove: palette.removedText,
  }[kind];

  const fill = kind === "add" ? palette.addedEmphasis : palette.removedEmphasis;

  return (
    <Text
      style={[styles.code, style, { color: colour }]}
      maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
    >
      {emphasis.length === 0
        ? text
        : segments(text, emphasis).map((part, i) =>
            part.marked ? (
              <Text key={i} style={{ backgroundColor: fill }}>
                {part.text}
              </Text>
            ) : (
              part.text
            )
          )}
    </Text>
  );
});

const numberOf = (line: Line) => (line.line === "remove" ? line.oldNumber : line.newNumber);

/** One unified line (MX-Q). */
export const UnifiedLine = memo(function UnifiedLine({
  line,
  palette,
  gutter,
}: {
  readonly line: Line;
  readonly palette: DiffPalette;
  readonly gutter: number;
}) {
  const styles = useStyles();
  const fill = lineFill(palette, line.line);
  const signColour = line.line === "add" ? palette.addedText : palette.removedText;

  return (
    <View style={[styles.row, fill === undefined ? null : { backgroundColor: fill }]}>
      <Text
        style={[styles.number, { width: gutter }]}
        numberOfLines={1}
        maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
      >
        {numberOf(line) ?? ""}
      </Text>
      <Text style={[styles.sign, { color: signColour }]} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
        {SIGN[line.line]}
      </Text>
      <CodeText text={line.text} emphasis={line.emphasis} kind={line.line} palette={palette} />
    </View>
  );
});

/** One side of a split row (MX-R); an empty side is a well. */
const SplitCell = ({
  line,
  palette,
  gutter,
  rule,
}: {
  readonly line: Line | null;
  readonly palette: DiffPalette;
  readonly gutter: number;
  readonly rule: string | null;
}) => {
  const styles = useStyles();

  if (line === null) return <View style={[styles.cell, styles.filler]} />;
  const fill = lineFill(palette, line.line);

  return (
    <View
      style={[
        styles.cell,
        fill === undefined ? null : { backgroundColor: fill },
        rule === null ? null : { borderRightWidth: 2, borderRightColor: rule },
      ]}
    >
      <Text
        style={[styles.number, { width: gutter }]}
        numberOfLines={1}
        maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
      >
        {numberOf(line) ?? ""}
      </Text>
      <CodeText text={line.text} emphasis={line.emphasis} kind={line.line} palette={palette} />
    </View>
  );
};

/** A row of the split diff; `rule` is the flagging finding's colour on the new side. */
export const SplitLine = memo(function SplitLine({
  old,
  new: nu,
  palette,
  gutter,
  rule,
}: {
  readonly old: Line | null;
  readonly new: Line | null;
  readonly palette: DiffPalette;
  readonly gutter: number;
  readonly rule: string | null;
}) {
  const styles = useStyles();

  return (
    <View style={styles.split}>
      <SplitCell line={old} palette={palette} gutter={gutter} rule={null} />
      <SplitCell line={nu} palette={palette} gutter={gutter} rule={rule} />
    </View>
  );
});

export const mono = {
  fontFamily: mobileType.index.fontFamily,
  fontSize: 12,
  lineHeight: 19,
} as const;

const useStyles = themedStyles((colours) => ({
  row: { flexDirection: "row", gap: 6, paddingLeft: 10, paddingRight: 12 },
  number: { ...mono, color: colours.textFaint },
  sign: { ...mono, width: DIGIT_WIDTH },
  code: { ...mono, flex: 1, minHeight: 19 },
  split: { flexDirection: "row", gap: 1, backgroundColor: colours.hairline },
  cell: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 10,
    backgroundColor: colours.panel,
  },
  filler: { backgroundColor: colours.well, minHeight: 19 },
}));
