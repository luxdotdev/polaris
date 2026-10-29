/**
 * The diff (Paper M5) as one virtualized list: file headers with +/− and severity badges, hunk
 * bands, unified lines on the diff fills (or the colourblind pair), the flagged line's glyph and
 * 2px rule, changed tokens filled, and Risk Findings under the line they flag.
 */
import { mobileType } from "@polaris/ui/tokens";
import { forwardRef, memo, useCallback } from "react";
import {
  FlatList,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { CodeText } from "../diff/lines.tsx";
import { themedStyles, useTheme } from "../theme/index.ts";
import type { DiffRow, FileRow, LineRow } from "./diffRows.ts";
import { type FindingActions, FindingRowView } from "./FindingCard.tsx";
import type { DiffPalette } from "./palette.ts";
import { SeverityBadge, severityColour, SeverityGlyph } from "./severity.tsx";

const Chevron = ({ open }: { readonly open: boolean }) => {
  const styles = useStyles();

  return <Text style={[styles.chevron, open && styles.chevronOpen]}>›</Text>;
};

const FileHeader = memo(function FileHeader({
  row,
  palette,
  onToggle,
}: {
  readonly row: FileRow;
  readonly palette: DiffPalette;
  readonly onToggle: (path: string) => void;
}) {
  const styles = useStyles();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: row.open }}
      style={styles.file}
      onPress={() => onToggle(row.path)}
    >
      <Chevron open={row.open} />
      <Text style={styles.path} numberOfLines={1} ellipsizeMode="head">
        {row.path}
      </Text>
      <Text style={[styles.count, { color: palette.addedText }]}>+{row.added}</Text>
      <Text style={[styles.count, { color: palette.removedText }]}>−{row.removed}</Text>
      {row.severities.slice(0, 2).map((severity) => (
        <SeverityBadge key={severity} severity={severity} />
      ))}
    </Pressable>
  );
});

const SIGN = { context: " ", add: "+", remove: "-" } as const;

const FILL: Readonly<Record<LineRow["line"], (p: DiffPalette) => string | undefined>> = {
  context: () => undefined,
  add: (p) => p.addedBg,
  remove: (p) => p.removedBg,
};

const Line = memo(function Line({
  row,
  palette,
}: {
  readonly row: LineRow;
  readonly palette: DiffPalette;
}) {
  const styles = useStyles();
  const { colours } = useTheme();
  const fill = FILL[row.line](palette);
  const signColour = row.line === "add" ? palette.addedText : palette.removedText;
  const number = row.line === "remove" ? null : row.newNumber;

  return (
    <View style={[styles.line, fill === undefined ? null : { backgroundColor: fill }]}>
      <View style={styles.markLane}>
        {row.mark === null ? null : <SeverityGlyph severity={row.mark} size={8} />}
      </View>
      <Text style={styles.number}>{number ?? ""}</Text>
      <Text style={[styles.sign, { color: signColour }]}>{SIGN[row.line]}</Text>
      <CodeText
        text={row.text}
        emphasis={row.emphasis}
        kind={row.line}
        palette={palette}
        style={styles.code}
      />
      {row.mark === null ? null : (
        <View style={[styles.rule, { backgroundColor: severityColour(colours, row.mark) }]} />
      )}
    </View>
  );
});

export interface DiffListProps {
  readonly rows: ReadonlyArray<DiffRow>;
  readonly palette: DiffPalette;
  readonly expanded: ReadonlySet<string>;
  readonly actions: FindingActions;
  readonly onToggleFile: (path: string) => void;
  readonly onToggleFinding: (id: string) => void;
  readonly bottomInset: number;
  readonly onScroll?: ((event: NativeSyntheticEvent<NativeScrollEvent>) => void) | undefined;
}

const keyOf = (row: DiffRow) => row.key;

export const DiffList = forwardRef<FlatList<DiffRow>, DiffListProps>(function DiffList(
  { rows, palette, expanded, actions, onToggleFile, onToggleFinding, bottomInset, onScroll },
  ref
) {
  const styles = useStyles();

  const render = useCallback<ListRenderItem<DiffRow>>(
    ({ item }) => {
      switch (item.kind) {
        case "file":
          return <FileHeader row={item} palette={palette} onToggle={onToggleFile} />;
        case "hunk":
          return (
            <Text style={styles.hunk} numberOfLines={1}>
              {item.header}
            </Text>
          );
        case "line":
          return <Line row={item} palette={palette} />;
        case "note":
          return <Text style={styles.note}>{item.text}</Text>;
        case "finding":
          return (
            <FindingRowView
              finding={item.finding}
              expanded={expanded.has(item.finding.id)}
              onToggle={onToggleFinding}
              actions={actions}
            />
          );
      }
    },
    [styles, palette, expanded, actions, onToggleFile, onToggleFinding]
  );

  return (
    <FlatList
      ref={ref}
      data={rows}
      keyExtractor={keyOf}
      renderItem={render}
      extraData={render}
      initialNumToRender={30}
      maxToRenderPerBatch={40}
      windowSize={9}
      removeClippedSubviews
      onScroll={onScroll}
      scrollEventThrottle={16}
      contentContainerStyle={{ paddingBottom: bottomInset }}
      indicatorStyle="white"
    />
  );
});

const mono = { fontFamily: mobileType.command.fontFamily, fontSize: 12, lineHeight: 16 } as const;

const useStyles = themedStyles((colours) => ({
  file: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 48,
    paddingHorizontal: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colours.hairline,
  },
  chevron: { ...mobileType.subhead, width: 10, color: colours.textSubtle },
  chevronOpen: { transform: [{ rotate: "90deg" }] },
  path: { ...mono, fontSize: 13, color: colours.textDefault, flex: 1 },
  count: { ...mobileType.footnote, lineHeight: 16 },
  hunk: {
    ...mono,
    fontSize: 11,
    lineHeight: 22,
    height: 22,
    paddingHorizontal: 14,
    color: colours.textFaint,
    backgroundColor: colours.ground,
  },
  line: {
    flexDirection: "row",
    alignItems: "flex-start",
    minHeight: 22,
    paddingVertical: 3,
    backgroundColor: colours.panel,
  },
  markLane: { width: 14, height: 16, alignItems: "center", justifyContent: "center" },
  number: { ...mono, width: 30, textAlign: "right", color: colours.textFaint },
  sign: { ...mono, width: 22, textAlign: "center" },
  code: { ...mono, flex: 1, paddingRight: 12, color: colours.textDefault },
  rule: { position: "absolute", left: 0, top: 0, bottom: 0, width: 2 },
  note: {
    ...mobileType.footnote,
    lineHeight: 16,
    paddingHorizontal: 20,
    paddingVertical: 14,
    color: colours.textSubtle,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colours.hairline,
  },
}));
