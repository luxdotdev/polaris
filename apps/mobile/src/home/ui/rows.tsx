/**
 * Session rows as wells on the ground (Paper MX-I): working, needs you, done, failed, dormant, each
 * with its celestial; constellation rows with their task bar (MX-C).
 */
import { mobileFont } from "@polaris/ui/tokens";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { Celestial, leadStar, sessionCelestial } from "../../celestial/index.tsx";
import { LongPressMenu } from "../../menus/index.ts";
import { themedStyles, useTheme } from "../../theme/index.ts";
import { age } from "../model/format.ts";
import type { ConstellationRow, SessionRow as Row } from "../model/home.ts";
import { type ConstellationProgress, progressLine, sevenSegments } from "../model/taskBar.ts";
import { type RowMenu, titleOf } from "./NeedsYouCard.tsx";
import { celestialLook, harnessHue, type MetaTone, metaLine } from "./rowLook.ts";
import { CONTENT_TEXT_SCALE } from "./textScale.ts";

const WASH_WIDTH = 168;

const WASH_HEIGHT = 32;

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

/** MX-I's wash: 1pt dots on a 2pt grid, thinning out from the row's top-left corner. */
const WASH_DOTS = (() => {
  let d = "";

  for (let y = 0; y < WASH_HEIGHT / 2; y++)
    for (let x = 0; x < WASH_WIDTH / 2; x++) {
      const lit = 1 - Math.hypot((x * 2) / 110, (y * 2) / 66) * 0.9;
      const threshold = ((BAYER4[y % 4]?.[x % 4] ?? 0) + 0.5) / 16;

      if (threshold < lit) d += `M${x * 2} ${y * 2}h1v1h-1z`;
    }

  return d;
})();

/** A working row's corner: the Harness hue's glow and dither behind the celestial. */
const WorkingWash = ({ color }: { readonly color: string }) => (
  <Svg width={WASH_WIDTH} height={WASH_HEIGHT} style={StyleSheet.absoluteFill} pointerEvents="none">
    <Defs>
      <RadialGradient id="wash" cx={0} cy={0} rx={110} ry={66} gradientUnits="userSpaceOnUse">
        <Stop offset={0} stopColor={color} stopOpacity={0.09} />
        <Stop offset={1} stopColor={color} stopOpacity={0} />
      </RadialGradient>
    </Defs>
    <Rect width={WASH_WIDTH} height={WASH_HEIGHT} fill="url(#wash)" />
    <Path d={WASH_DOTS} fill={color} fillOpacity={0.29} />
  </Svg>
);

/** A well that dips when pressed; a long press lifts it into its menu. */
const Well = ({
  onOpen,
  menu,
  stale,
  children,
}: {
  readonly onOpen: () => void;
  readonly menu: RowMenu | undefined;
  readonly stale: boolean;
  readonly children: ReactNode;
}) => {
  const styles = useStyles();

  const well = (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [
        styles.well,
        pressed ? styles.pressed : null,
        stale ? styles.stale : null,
      ]}
    >
      {children}
    </Pressable>
  );

  return menu === undefined ? (
    well
  ) : (
    <LongPressMenu menu={menu.menu} onAction={menu.onAction}>
      {well}
    </LongPressMenu>
  );
};

const Top = ({
  title,
  since,
  now,
}: {
  readonly title: string;
  readonly since: number;
  readonly now: number;
}) => {
  const styles = useStyles();

  return (
    <View style={styles.top}>
      <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.age}>
        {age(since, now)}
      </Text>
    </View>
  );
};

const leadStyle = (styles: ReturnType<typeof useStyles>, tone: MetaTone) =>
  ({ "needs-you": styles.leadNeedsYou, failed: styles.leadFailed, default: styles.leadDefault })[
    tone
  ];

export interface SessionRowProps {
  readonly row: Row;
  readonly now: number;
  /** Several Hosts: the meta line names this row's. */
  readonly withHost: boolean;
  readonly onOpen: () => void;
  readonly menu?: RowMenu | undefined;
}

export const SessionRow = ({ row, now, withHost, onOpen, menu }: SessionRowProps) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const look = celestialLook(row.session.state);
  const line = metaLine(row, withHost);

  return (
    <Well onOpen={onOpen} menu={menu} stale={row.stale}>
      {look.working ? <WorkingWash color={harnessHue(colours, row.session.harness)} /> : null}
      <View style={styles.inner}>
        <View style={styles.mark}>
          <Celestial
            body={sessionCelestial(row.session.celestial)}
            harness={row.session.harness}
            size={24}
            working={look.working}
            dormant={look.dormant}
          />
        </View>
        <View style={styles.text}>
          <Top title={titleOf(row.session.title)} since={row.since} now={now} />
          <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.meta} numberOfLines={1}>
            {line.lead === null ? null : (
              <Text
                maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
                style={leadStyle(styles, line.lead.tone)}
              >
                {line.lead.text}
              </Text>
            )}
            {line.lead !== null && line.rest !== "" ? " · " : null}
            {line.rest}
          </Text>
        </View>
      </View>
    </Well>
  );
};

export const TaskBar = ({
  progress,
  harness,
}: {
  readonly progress: ConstellationProgress;
  /** The lead's Harness: working segments keep its hue (rule/constellation-colour). */
  readonly harness: string;
}) => {
  const styles = useStyles();
  const { colours } = useTheme();

  const segmentColor = {
    done: colours.acceptedText,
    working: harnessHue(colours, harness),
    rest: colours.fillSelected,
  } as const;

  return (
    <View style={styles.bar}>
      {sevenSegments(progress).map((segment, index) => (
        <View key={index} style={[styles.segment, { backgroundColor: segmentColor[segment] }]} />
      ))}
    </View>
  );
};

/** Before the task counts arrive, or while the Host is away: the bar, all dark. */
const UNKNOWN_PROGRESS: ConstellationProgress = { done: 0, working: 0, total: 0 };

export const ConstellationListRow = ({
  row,
  progress,
  now,
  onOpen,
  menu,
}: {
  readonly row: ConstellationRow;
  readonly progress: ConstellationProgress | null;
  readonly now: number;
  readonly onOpen: () => void;
  readonly menu?: RowMenu | undefined;
}) => {
  const styles = useStyles();
  const harness = row.lead?.harness ?? "";

  return (
    <Well onOpen={onOpen} menu={menu} stale={row.stale}>
      <View style={styles.inner}>
        <View style={styles.mark}>
          <Celestial
            body={leadStar(row.lead?.celestial)}
            harness={harness}
            size={24}
            working={row.lead?.state === "working"}
          />
        </View>
        <View style={styles.text}>
          <Top title={row.constellation.name} since={row.since} now={now} />
          <View style={styles.progress}>
            <TaskBar progress={progress ?? UNKNOWN_PROGRESS} harness={harness} />
            <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.meta} numberOfLines={1}>
              {progressLine(progress)}
            </Text>
          </View>
        </View>
      </View>
    </Well>
  );
};

/** Paper MX-I: a 14pt-radius well, 12/14 padding, a 24pt celestial, 16pt titles, mono ages. */
const useStyles = themedStyles((colours) => ({
  well: {
    backgroundColor: colours.panel,
    borderColor: colours.hairline,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    overflow: "hidden",
  },
  pressed: { backgroundColor: colours.raised, transform: [{ scale: 0.985 }] },
  stale: { opacity: 0.55 },
  inner: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  mark: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, minWidth: 0, gap: 2 },
  top: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: {
    flex: 1,
    fontFamily: mobileFont.sans,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "500",
    color: colours.textStrong,
  },
  age: {
    fontFamily: mobileFont.mono,
    fontSize: 12,
    lineHeight: 16,
    color: colours.textSubtle,
    fontVariant: ["tabular-nums"],
  },
  // A right-to-left reply preview first would otherwise flip the whole line's order.
  meta: {
    fontFamily: mobileFont.sans,
    fontSize: 13,
    lineHeight: 18,
    color: colours.textSubtle,
    writingDirection: "ltr",
  },
  leadNeedsYou: { color: colours.needsYouText, fontWeight: "500" },
  leadFailed: { color: colours.failedText, fontWeight: "500" },
  leadDefault: { color: colours.textDefault },
  progress: { flexDirection: "row", alignItems: "center", gap: 8, height: 18 },
  bar: { flexDirection: "row", gap: 3 },
  segment: { width: 14, height: 4, borderRadius: 1 },
}));
