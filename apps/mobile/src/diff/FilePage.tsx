/**
 * One file's diff in its panel, one page of the full-screen pager: unified lines in portrait
 * (MX-Q), before and after side by side in landscape (MX-R), findings under their lines.
 */
import type { RiskFinding } from "@polaris/protocol";
import { mobileType } from "@polaris/ui/tokens";
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from "react";
import { FlatList, type ListRenderItem, Text, useWindowDimensions, View } from "react-native";
import type { DiffFileInput } from "../review/diffRows.ts";
import type { DiffPalette } from "../review/palette.ts";
import { severityColour } from "../review/severity.tsx";
import { themedStyles, useTheme } from "../theme/index.ts";
import { CHROME_TEXT_SCALE } from "../theme/textScale.ts";
import { DiffFindingCard } from "./FindingCard.tsx";
import { gutterWidth, SplitLine, UnifiedLine } from "./lines.tsx";
import { fileRows, hunkStarts, largestNumber, type Layout, type ScreenRow } from "./rows.ts";
import type { DiffFindingActions } from "./types.ts";

export interface FilePageHandle {
  /** Scrolls to the next or previous hunk's header. */
  readonly step: (direction: 1 | -1) => void;
}

export interface FilePageProps {
  readonly file: DiffFileInput;
  readonly findings: ReadonlyArray<RiskFinding>;
  readonly palette: DiffPalette;
  readonly layout: Layout;
  readonly width: number;
  readonly bottomInset: number;
  readonly actions?: DiffFindingActions | undefined;
}

const keyOf = (row: ScreenRow) => row.key;

/** The hunk header after (or before) the first row in view, if there is one. */
export const nextHunk = (
  starts: ReadonlyArray<number>,
  top: number,
  direction: 1 | -1
): number | undefined =>
  direction === 1 ? starts.find((s) => s > top) : [...starts].reverse().find((s) => s < top);

export const FilePage = forwardRef<FilePageHandle, FilePageProps>(function FilePage(
  { file, findings, palette, layout, width, bottomInset, actions },
  ref
) {
  const styles = useStyles();
  const { colours } = useTheme();
  const { fontScale } = useWindowDimensions();
  const list = useRef<FlatList<ScreenRow>>(null);
  const top = useRef(0);
  const rows = useMemo(() => fileRows(file.diff, findings, layout), [file, findings, layout]);
  const starts = useMemo(() => hunkStarts(rows), [rows]);
  const gutter = gutterWidth(largestNumber(file.diff)) * Math.min(fontScale, 2);

  useImperativeHandle(
    ref,
    () => ({
      step: (direction) => {
        const index = nextHunk(starts, top.current, direction);

        if (index !== undefined) list.current?.scrollToIndex({ index, animated: true });
      },
    }),
    [starts]
  );

  const onViewable = useRef(
    ({
      viewableItems,
    }: {
      viewableItems: ReadonlyArray<{ readonly index?: number | null | undefined }>;
    }) => {
      top.current = Math.min(...viewableItems.map((v) => v.index ?? 0), Number.MAX_SAFE_INTEGER);
    }
  ).current;

  const render = useCallback<ListRenderItem<ScreenRow>>(
    ({ item }) => {
      switch (item.kind) {
        case "hunk":
          return (
            <Text style={styles.hunk} numberOfLines={1} maxFontSizeMultiplier={CHROME_TEXT_SCALE}>
              {item.header}
            </Text>
          );
        case "line":
          return <UnifiedLine line={item.line} palette={palette} gutter={gutter} />;
        case "pair":
          return (
            <SplitLine
              old={item.pair.old}
              new={item.pair.new}
              palette={palette}
              gutter={gutter}
              rule={item.mark === null ? null : severityColour(colours, item.mark)}
            />
          );
        case "finding":
          return <DiffFindingCard finding={item.finding} actions={actions} />;
      }
    },
    [styles, palette, gutter, colours, actions]
  );

  return (
    <View style={[styles.page, { width }]}>
      <View style={[styles.panel, layout === "split" && styles.panelSplit]}>
        {layout === "split" ? (
          <View style={styles.sides}>
            <Text style={styles.side}>BEFORE</Text>
            <Text style={styles.side}>AFTER</Text>
          </View>
        ) : null}
        <FlatList
          ref={list}
          data={rows}
          keyExtractor={keyOf}
          renderItem={render}
          initialNumToRender={40}
          maxToRenderPerBatch={40}
          windowSize={9}
          onViewableItemsChanged={onViewable}
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            list.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
            setTimeout(() => list.current?.scrollToIndex({ index, animated: true }), 50);
          }}
          contentContainerStyle={{
            paddingTop: layout === "split" ? 0 : 8,
            paddingBottom: bottomInset,
          }}
          indicatorStyle="white"
        />
      </View>
    </View>
  );
});

const useStyles = themedStyles((colours) => ({
  page: { flex: 1 },
  panel: {
    flex: 1,
    overflow: "hidden",
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colours.hairline,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: colours.panel,
  },
  panelSplit: { borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  hunk: {
    ...mobileType.index,
    fontSize: 11,
    lineHeight: 14,
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 8,
    color: colours.textFaint,
  },
  sides: { flexDirection: "row", gap: 1, backgroundColor: colours.hairline },
  side: {
    ...mobileType.index,
    flex: 1,
    fontSize: 11,
    lineHeight: 14,
    paddingVertical: 7,
    paddingHorizontal: 10,
    color: colours.textFaint,
    backgroundColor: colours.panel,
  },
}));
