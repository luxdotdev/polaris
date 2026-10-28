/**
 * An agent's message as Markdown, in Midnight and the mobile type scale: the views for the blocks
 * `parse.ts` produces. Blocks are memoized by identity, so a streaming message redraws only its
 * open block, and links open in the browser.
 */
import { midnight, mobileFont, mobileType, mobileWeight } from "@polaris/ui/tokens";
import { memo, useMemo } from "react";
import {
  Linking,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";
import { lineOf } from "./line.ts";
import type { Align, Block, ListItem, Mark, Span, Spans } from "./model.ts";
import { parseMarkdown } from "./parse.ts";

type Tone = "default" | "quote";

const MARK_STYLES: Readonly<Record<Mark, TextStyle>> = {
  strong: { fontWeight: mobileWeight.medium, color: midnight.textStrong },
  em: { fontStyle: "italic" },
  del: { textDecorationLine: "line-through", color: midnight.textSubtle },
  code: {
    fontFamily: mobileFont.mono,
    fontSize: 13,
    backgroundColor: midnight.surfaceRaised,
  },
};

const open = (href: string) => {
  Linking.openURL(href).catch(() => undefined);
};

const SpanText = ({ span }: { readonly span: Span }) => {
  const style = span.marks.map((mark) => MARK_STYLES[mark]);

  if (span.href === null) return <Text style={style}>{span.text}</Text>;

  const href = span.href;

  return (
    <Text
      style={[...style, styles.link]}
      onPress={() => open(href)}
      accessibilityRole="link"
      accessibilityHint={href}
    >
      {span.text}
    </Text>
  );
};

const spanViews = (spans: Spans) => spans.map((span, i) => <SpanText key={i} span={span} />);

const toneStyle = (tone: Tone) => (tone === "quote" ? styles.quoteText : null);

const HEADINGS: ReadonlyArray<TextStyle> = [
  { ...mobileType.title, color: midnight.textStrong },
  { ...mobileType.heading, color: midnight.textStrong },
];

const headingStyle = (level: number): TextStyle =>
  HEADINGS[level - 1] ?? { fontWeight: mobileWeight.medium, color: midnight.textStrong };

const CodeBlock = ({ lang, text }: { readonly lang: string; readonly text: string }) => (
  <View style={styles.code}>
    {lang === "" ? null : <Text style={styles.codeLang}>{lang}</Text>}
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <Text style={styles.codeText} selectable>
        {text}
      </Text>
    </ScrollView>
  </View>
);

const Marker = ({ item }: { readonly item: ListItem }) => {
  if (item.checked === null)
    return (
      <Text style={[styles.marker, item.marker.endsWith(".") ? styles.ordinal : null]}>
        {item.marker}
      </Text>
    );

  return (
    <View
      style={[styles.box, item.checked ? styles.boxChecked : null]}
      accessible
      accessibilityRole="checkbox"
      accessibilityState={{ checked: item.checked }}
    >
      {item.checked ? <Text style={styles.tick}>✓</Text> : null}
    </View>
  );
};

const List = ({
  items,
  tone,
}: {
  readonly items: ReadonlyArray<ListItem>;
  readonly tone: Tone;
}) => (
  <View style={styles.list}>
    {items.map((item, i) => (
      <View key={i} style={styles.item}>
        <View style={styles.markerSlot}>
          <Marker item={item} />
        </View>
        <View style={styles.itemBody}>
          <Blocks blocks={item.blocks} tone={tone} gap={styles.itemGap} />
        </View>
      </View>
    ))}
  </View>
);

const CHAR_WIDTH = 7.5;

const columnWidth = (chars: number) => Math.max(56, Math.round(chars * CHAR_WIDTH) + 20);

const TEXT_ALIGN: Readonly<Record<Align, TextStyle>> = {
  left: { textAlign: "left" },
  center: { textAlign: "center" },
  right: { textAlign: "right" },
};

const Table = ({ block }: { readonly block: Extract<Block, { kind: "table" }> }) => {
  const row = (cells: ReadonlyArray<Spans>, header: boolean, key: number) => (
    <View key={key} style={[styles.tableRow, header ? styles.tableHeader : null]}>
      {block.columnChars.map((chars, column) => (
        <Text
          key={column}
          style={[
            styles.cell,
            header ? styles.headerCell : null,
            TEXT_ALIGN[block.align[column] ?? "left"],
            { width: columnWidth(chars) },
          ]}
        >
          {spanViews(cells[column] ?? [])}
        </Text>
      ))}
    </View>
  );

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.table}>
        {row(block.header, true, -1)}
        {block.rows.map((cells, i) => row(cells, false, i))}
      </View>
    </ScrollView>
  );
};

const BlockView = memo(({ block, tone }: { readonly block: Block; readonly tone: Tone }) => {
  switch (block.kind) {
    case "paragraph":
      return (
        <Text style={[styles.text, toneStyle(tone)]} selectable>
          {spanViews(block.spans)}
        </Text>
      );
    case "heading":
      return (
        <Text
          style={[styles.text, headingStyle(block.level)]}
          selectable
          accessibilityRole="header"
        >
          {spanViews(block.spans)}
        </Text>
      );
    case "code":
      return <CodeBlock lang={block.lang} text={block.text} />;
    case "quote":
      return (
        <View style={styles.quote}>
          <Blocks blocks={block.blocks} tone="quote" gap={styles.blockGap} />
        </View>
      );
    case "list":
      return <List items={block.items} tone={tone} />;
    case "table":
      return <Table block={block} />;
    case "rule":
      return <View style={styles.rule} />;
  }
});

const Blocks = ({
  blocks,
  tone,
  gap,
}: {
  readonly blocks: ReadonlyArray<Block>;
  readonly tone: Tone;
  readonly gap: ViewStyle;
}) => (
  <View style={gap}>
    {blocks.map((block, i) => (
      <BlockView key={i} block={block} tone={tone} />
    ))}
  </View>
);

export interface MarkdownProps {
  readonly text: string;
  readonly style?: StyleProp<ViewStyle>;
}

/** A message as Markdown blocks; text may still be streaming in. */
export const Markdown = memo(({ text, style }: MarkdownProps) => {
  const { blocks } = useMemo(() => parseMarkdown(text), [text]);

  return (
    <View style={style}>
      <Blocks blocks={blocks} tone="default" gap={styles.blockGap} />
    </View>
  );
});

export interface MarkdownLineProps {
  readonly text: string;
  readonly style?: StyleProp<TextStyle>;
  readonly numberOfLines?: number;
}

/** A message in a few lines of one text: emphasis and code styled, a line per block. */
export const MarkdownLine = memo(({ text, style, numberOfLines }: MarkdownLineProps) => {
  const spans = useMemo(() => lineOf(parseMarkdown(text).blocks), [text]);

  return (
    <Text style={style} {...(numberOfLines === undefined ? {} : { numberOfLines })}>
      {spanViews(spans)}
    </Text>
  );
});

const styles = StyleSheet.create({
  blockGap: { gap: 10 },
  itemGap: { gap: 4 },
  text: { ...mobileType.callout, lineHeight: 22, color: midnight.textDefault },
  quoteText: { color: midnight.textSubtle },
  link: {
    color: midnight.textStrong,
    textDecorationLine: "underline",
    textDecorationColor: midnight.textFaint,
  },
  code: {
    backgroundColor: midnight.surfaceSunken,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: midnight.hairline,
    borderRadius: 10,
    overflow: "hidden",
  },
  codeLang: {
    ...mobileType.footnote,
    color: midnight.textSubtle,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: midnight.hairline,
  },
  codeText: {
    ...mobileType.command,
    fontSize: 13,
    lineHeight: 19,
    color: midnight.textDefault,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  quote: {
    borderLeftWidth: 2,
    borderLeftColor: midnight.hairline,
    paddingLeft: 12,
  },
  list: { gap: 6 },
  item: { flexDirection: "row" },
  markerSlot: { minWidth: 20, paddingRight: 6, alignItems: "flex-start" },
  marker: { ...mobileType.callout, lineHeight: 22, color: midnight.textSubtle },
  ordinal: { fontVariant: ["tabular-nums"] },
  itemBody: { flex: 1 },
  box: {
    width: 14,
    height: 14,
    marginTop: 4,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: midnight.textFaint,
    alignItems: "center",
    justifyContent: "center",
  },
  boxChecked: { borderColor: midnight.textSubtle, backgroundColor: midnight.textSubtle },
  tick: { fontSize: 10, lineHeight: 12, color: midnight.bg, fontWeight: mobileWeight.medium },
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: midnight.hairline,
    borderRadius: 10,
    overflow: "hidden",
  },
  tableRow: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: midnight.hairline,
  },
  tableHeader: { borderTopWidth: 0, backgroundColor: midnight.surfaceSunken },
  cell: {
    ...mobileType.footnote,
    color: midnight.textDefault,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  headerCell: { color: midnight.textSubtle, fontWeight: mobileWeight.medium },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: midnight.hairline, marginVertical: 4 },
});
