/**
 * The queue's wells (Paper MX-K): each waiting turn with its severity counts, and MX-M's clean lane,
 * where a turn with no findings is accepted in place.
 */
import { mobileFont, mobileWeight } from "@polaris/ui/tokens";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Celestial, sessionCelestial } from "../../celestial/index.tsx";
import { age } from "../../home/model/format.ts";
import { titleOf } from "../../home/ui/NeedsYouCard.tsx";
import { LongPressMenu, type MenuAction, sessionMenu } from "../../menus/index.ts";
import { themedStyles, useTheme } from "../../theme/index.ts";
import { CHROME_TEXT_SCALE, CONTENT_TEXT_SCALE } from "../../theme/textScale.ts";
import { SEVERITIES } from "../model.ts";
import { SeverityGlyph, severityText } from "../severity.tsx";
import { QueueAccept } from "./actions.tsx";
import { type QueueItem, riskNote, wellMeta } from "./queue.ts";

export interface WellActions {
  readonly now: number;
  readonly withHost: boolean;
  readonly open: (item: QueueItem) => void;
  readonly onMenu: (action: MenuAction) => void;
}

const Counts = ({ item }: { readonly item: QueueItem }) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const shown = SEVERITIES.filter((severity) => item.tally[severity] > 0);
  const note = riskNote(item);

  if (shown.length === 0)
    return note === null ? null : (
      <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.note}>
        {note}
      </Text>
    );

  return (
    <View style={styles.counts}>
      {shown.map((severity, n) => (
        <View key={severity} style={[styles.count, n > 0 ? styles.countGap : null]}>
          <SeverityGlyph severity={severity} size={severity === "high" ? 9 : 7} />
          <Text
            maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
            style={[styles.countText, { color: severityText(colours, severity) }]}
          >
            {item.tally[severity]}
          </Text>
        </View>
      ))}
    </View>
  );
};

const Well = ({
  item,
  actions,
  children,
}: {
  readonly item: QueueItem;
  readonly actions: WellActions;
  readonly children: ReactNode;
}) => {
  const styles = useStyles();

  return (
    <LongPressMenu menu={sessionMenu(item.row)} onAction={actions.onMenu}>
      <Pressable
        accessibilityRole="button"
        onPress={() => actions.open(item)}
        style={({ pressed }) => [
          styles.well,
          pressed ? styles.pressed : null,
          item.row.stale ? styles.stale : null,
        ]}
      >
        <Celestial
          body={sessionCelestial(item.row.session.celestial)}
          harness={item.row.session.harness}
          size={24}
        />
        {children}
      </Pressable>
    </LongPressMenu>
  );
};

/** A waiting turn: title and age, then its line and severity counts. */
export const QueueWell = ({
  item,
  actions,
}: {
  readonly item: QueueItem;
  readonly actions: WellActions;
}) => {
  const styles = useStyles();

  return (
    <Well item={item} actions={actions}>
      <View style={styles.text}>
        <View style={styles.line}>
          <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.title} numberOfLines={1}>
            {titleOf(item.row.session.title)}
          </Text>
          <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.age}>
            {age(item.row.since, actions.now)}
          </Text>
        </View>
        <View style={styles.line}>
          <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.meta} numberOfLines={1}>
            {wellMeta(item, actions.withHost)}
          </Text>
          <Counts item={item} />
        </View>
      </View>
    </Well>
  );
};

/** MX-M's clean row: no findings, so Accept sits on the row. */
export const CleanWell = ({
  item,
  actions,
}: {
  readonly item: QueueItem;
  readonly actions: WellActions;
}) => {
  const styles = useStyles();

  return (
    <Well item={item} actions={actions}>
      <View style={styles.text}>
        <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.title} numberOfLines={1}>
          {titleOf(item.row.session.title)}
        </Text>
        <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.meta} numberOfLines={1}>
          {wellMeta(item, actions.withHost)}
        </Text>
      </View>
      <QueueAccept item={item} />
    </Well>
  );
};

export const LaneHead = ({ label }: { readonly label: string }) => {
  const styles = useStyles();

  return (
    <View style={styles.head}>
      <Text
        maxFontSizeMultiplier={CHROME_TEXT_SCALE}
        style={styles.kicker}
        accessibilityRole="header"
      >
        {label}
      </Text>
    </View>
  );
};

const mono = { fontFamily: mobileFont.mono, fontSize: 12, lineHeight: 16 } as const;

const useStyles = themedStyles((c) => ({
  well: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    paddingLeft: 14,
    paddingRight: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.hairline,
    backgroundColor: c.well,
  },
  pressed: { opacity: 0.7 },
  stale: { opacity: 0.55 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  line: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: {
    flex: 1,
    fontFamily: mobileFont.sans,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: mobileWeight.medium,
    color: c.textStrong,
  },
  age: { ...mono, color: c.textSubtle, fontVariant: ["tabular-nums"] },
  meta: {
    flex: 1,
    fontFamily: mobileFont.sans,
    fontSize: 13,
    lineHeight: 18,
    color: c.textSubtle,
  },
  counts: { flexDirection: "row", alignItems: "center" },
  count: { flexDirection: "row", alignItems: "center", gap: 4 },
  countGap: { marginLeft: 6 },
  countText: { ...mono, fontVariant: ["tabular-nums"] },
  note: { ...mono, color: c.textFaint },
  head: { paddingTop: 12, paddingBottom: 4, paddingHorizontal: 8 },
  kicker: {
    fontFamily: mobileFont.mono,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: mobileWeight.medium,
    letterSpacing: 0.88,
    textTransform: "uppercase",
    color: c.textSubtle,
  },
}));
