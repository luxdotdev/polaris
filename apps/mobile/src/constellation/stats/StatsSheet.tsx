/**
 * The stats sheet (Paper MX-AB; DESIGN.md Mobile chrome redesign · phase 2, Sheets): the
 * constellation's cost split by role, first-try review and worker time, from `constellation.stats`.
 */
import { mobileFont, mobileType } from "@polaris/ui/tokens";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { harnessColour } from "../../celestial/tones.ts";
import { harnessName } from "../../home/model/format.ts";
import type { HostConnection } from "../../runtime/hostConnection.ts";
import { InstrumentSheet } from "../../sheet/index.tsx";
import { themedStyles, useTheme } from "../../theme/index.ts";
import { CONTENT_TEXT_SCALE } from "../../theme/textScale.ts";
import type { ConstellationSource } from "../model.ts";
import { type ReviewCell, reportedPrice, type StatsSheetView, statsSheetView } from "./model.ts";
import { Kicker, SheetHead } from "./parts.tsx";
import { useConstellationStats } from "./useStats.ts";

export interface StatsSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly source: ConstellationSource;
  readonly connection: HostConnection;
  /** Claims handed to the user and not yet decided, for the review meter's open cells. */
  readonly waitingForYou: number;
}

const Split = ({ view }: { readonly view: StatsSheetView }) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const tint = { lead: colours.textDefault, worker: colours.textFaint } as const;

  return (
    <View style={styles.split}>
      <View style={styles.bar}>
        {view.roles.map((r) =>
          r.share <= 0 ? null : (
            <View
              key={r.role}
              style={[styles.segment, { flexGrow: r.share, backgroundColor: tint[r.role] }]}
            />
          )
        )}
      </View>
      <View style={styles.legend}>
        {view.roles.map((r) => (
          <View key={r.role} style={styles.legendItem}>
            <View style={[styles.square, { backgroundColor: tint[r.role] }]} />
            <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.legendText}>
              {r.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
};

const Cell = ({ cell }: { readonly cell: ReviewCell }) => {
  const styles = useStyles();

  return <View style={[styles.cell, styles[cell]]} />;
};

const Review = ({ review }: { readonly review: StatsSheetView["review"] }) => {
  const styles = useStyles();

  return (
    <View style={styles.well}>
      <View style={styles.spread}>
        <Kicker text="Review" />
        <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.aside}>
          {review.line}
        </Text>
      </View>
      {review.cells.length === 0 ? null : (
        <View style={styles.cells}>
          {review.cells.map((cell, i) => (
            // Cells have no identity: a fixed, ordered run.
            <Cell key={i} cell={cell} />
          ))}
        </View>
      )}
      {review.caption === null ? null : (
        <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.caption}>
          {review.caption}
        </Text>
      )}
    </View>
  );
};

const Workers = ({ workers }: { readonly workers: StatsSheetView["workers"] }) => {
  const styles = useStyles();
  const { colours } = useTheme();

  if (workers.rows.length === 0) return null;

  return (
    <View style={styles.workers}>
      <View style={styles.spread}>
        <Kicker text="Worker time" />
        {workers.total === null ? null : <Text style={styles.total}>{workers.total}</Text>}
      </View>
      {workers.rows.map((row) => (
        <View key={row.taskId} style={styles.workerRow}>
          <Text numberOfLines={1} maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.who}>
            {row.harness === null ? row.taskId : `${row.taskId} · ${harnessName(row.harness)}`}
          </Text>
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                {
                  width: `${Math.round(row.share * 100)}%`,
                  backgroundColor:
                    row.harness === null ? colours.textSubtle : harnessColour(colours, row.harness),
                },
              ]}
            />
          </View>
          <Text style={styles.time}>{row.time}</Text>
        </View>
      ))}
      {workers.rest === null ? null : (
        <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.caption}>
          {workers.rest}
        </Text>
      )}
    </View>
  );
};

const Body = ({
  view,
  onClose,
}: {
  readonly view: StatsSheetView;
  readonly onClose: () => void;
}) => {
  const styles = useStyles();

  return (
    <View style={styles.body}>
      <SheetHead onClose={onClose}>
        <Kicker text={view.measure === "cost" ? "Constellation cost" : "Constellation tokens"} />
        <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.headline}>
          {view.headline}
        </Text>
        <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.subline}>
          {view.subline}
        </Text>
      </SheetHead>
      <Split view={view} />
      <Review review={view.review} />
      <Workers workers={view.workers} />
    </View>
  );
};

const Unavailable = ({
  text,
  onClose,
}: {
  readonly text: string;
  readonly onClose: () => void;
}) => {
  const styles = useStyles();

  return (
    <View style={styles.body}>
      <SheetHead onClose={onClose}>
        <Kicker text="Constellation stats" />
        <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.subline}>
          {text}
        </Text>
      </SheetHead>
    </View>
  );
};

export const StatsSheet = ({
  open,
  onClose,
  source,
  connection,
  waitingForYou,
}: StatsSheetProps) => {
  const c = source.constellation;
  const state = useConstellationStats(connection, c.id, c.revision, open);

  const view = useMemo(
    () =>
      state.kind === "ready"
        ? statsSheetView({
            stats: state.stats,
            constellation: c,
            price: reportedPrice,
            waitingForYou,
          })
        : null,
    [state, c, waitingForYou]
  );

  return (
    <InstrumentSheet open={open} onClose={onClose} detents={["medium", "large"]}>
      {view !== null ? (
        <Body view={view} onClose={onClose} />
      ) : (
        <Unavailable
          text={state.kind === "failed" ? state.message : "Reading the stats…"}
          onClose={onClose}
        />
      )}
    </InstrumentSheet>
  );
};

const useStyles = themedStyles((colours) => ({
  body: { gap: 18, paddingHorizontal: 6, paddingBottom: 8 },
  headline: {
    fontFamily: mobileFont.mono,
    fontSize: 44,
    lineHeight: 52,
    fontWeight: "500",
    letterSpacing: -0.88,
    color: colours.textStrong,
  },
  subline: { ...mobileType.footnote, color: colours.textSubtle },
  split: { gap: 8 },
  bar: { flexDirection: "row", gap: 2, height: 8 },
  segment: { flexBasis: 0, borderRadius: 4 },
  legend: { flexDirection: "row", justifyContent: "space-between" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  square: { width: 8, height: 8, borderRadius: 2 },
  legendText: { ...mobileType.footnote, color: colours.textDefault },
  well: {
    gap: 8,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: colours.well,
    borderColor: colours.hairline,
  },
  spread: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
  },
  aside: { ...mobileType.footnote, color: colours.textSubtle, flexShrink: 1, textAlign: "right" },
  cells: { flexDirection: "row", gap: 3, height: 6 },
  cell: { flex: 1, borderRadius: 3 },
  accepted: { backgroundColor: colours.textDefault },
  "sent-back": { backgroundColor: colours.textFaint },
  waiting: { borderWidth: 1, borderColor: colours.hairline },
  caption: {
    fontFamily: mobileType.footnote.fontFamily,
    fontSize: 12,
    lineHeight: 16,
    color: colours.textFaint,
  },
  workers: { gap: 10 },
  total: { ...mobileType.index, color: colours.textDefault },
  workerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  who: { ...mobileType.footnote, color: colours.textDefault, width: 110 },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colours.raised },
  fill: { height: 6, borderRadius: 3 },
  time: { ...mobileType.index, color: colours.textSubtle, width: 40, textAlign: "right" },
}));
