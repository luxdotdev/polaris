/** Home's rows (Paper H4): needs you with its mono index and inline answer, working, recent, constellation. */
import { mobileType } from "@polaris/ui/tokens";
import { Pressable, Text, View } from "react-native";
import { LongPressMenu, type Menu, type MenuAction } from "../../menus/index.ts";
import { type MobileColours, themedStyles, useTheme } from "../../theme/index.ts";
import { age, rowIndex } from "../model/format.ts";
import { type ConstellationRow, type SessionRow, whereLine } from "../model/home.ts";
import { type Line, statusLine } from "../model/lines.ts";
import type { Reply } from "../model/respond.ts";
import { type ConstellationProgress, progressLine, sevenSegments } from "../model/taskBar.ts";
import { ApprovalActions } from "./ApprovalActions.tsx";
import { ConstellationTile, SessionTile } from "./Tile.tsx";

const titleOf = (title: string) => (title.trim() === "" ? "Untitled agent session" : title);

const toneColorOf = (colours: MobileColours): Record<Line["tone"], string> => ({
  subtle: colours.textSubtle,
  failed: colours.failedText,
  "needs-you": colours.needsYouText,
});

export const NeedsYouRow = ({
  row,
  position,
  first,
  now,
  onOpen,
  onReply,
  menu,
}: {
  readonly row: SessionRow;
  readonly position: number;
  /** The first row sits under the section's own hairline. */
  readonly first: boolean;
  readonly now: number;
  readonly onOpen: () => void;
  readonly onReply: (reply: Reply) => Promise<void>;
  /** On the head only: a long press in the reply field stays the field's. */
  readonly menu: { readonly menu: Menu; readonly onAction: (action: MenuAction) => void };
}) => {
  const styles = useStyles();

  return (
    <View
      style={[
        styles.needsYou,
        first ? styles.firstNeedsYou : null,
        row.stale ? styles.stale : null,
      ]}
    >
      <LongPressMenu menu={menu.menu} onAction={menu.onAction}>
        <Pressable accessibilityRole="button" onPress={onOpen} style={styles.needsYouHead}>
          <Text style={styles.index}>{rowIndex(position)}</Text>
          <SessionTile harness={row.session.harness} state={row.session.state} needsYou />
          <View style={styles.text}>
            <Text style={styles.needsYouTitle} numberOfLines={2}>
              {titleOf(row.session.title)}
            </Text>
            <Text style={styles.second} numberOfLines={1}>
              {whereLine(row)}
            </Text>
          </View>
          <Text style={styles.age}>{age(row.since, now)}</Text>
        </Pressable>
      </LongPressMenu>
      {row.approval === null ? null : (
        <ApprovalActions
          approval={row.approval}
          enabled={!row.stale}
          onReply={onReply}
          onOpen={onOpen}
        />
      )}
    </View>
  );
};

export const SessionListRow = ({
  row,
  now,
  withHost,
  onOpen,
}: {
  readonly row: SessionRow;
  readonly now: number;
  readonly withHost: boolean;
  readonly onOpen: () => void;
}) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const line = statusLine(row, withHost);
  const recent = row.session.state !== "working" && row.session.state !== "starting";

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      style={[styles.listRow, recent ? styles.recentRow : null, row.stale ? styles.stale : null]}
    >
      <SessionTile harness={row.session.harness} state={row.session.state} needsYou={false} />
      <View style={styles.text}>
        <Text style={[styles.listTitle, recent ? styles.recentTitle : null]} numberOfLines={1}>
          {titleOf(row.session.title)}
        </Text>
        <Text style={[styles.second, { color: toneColorOf(colours)[line.tone] }]} numberOfLines={1}>
          {line.text}
        </Text>
      </View>
      <Text style={styles.age}>{age(row.since, now)}</Text>
    </Pressable>
  );
};

/** Done is `accepted` and working stays neutral (rule/constellation-colour); never Starlight. */
const segmentColorOf = (colours: MobileColours) =>
  ({ done: colours.accepted, working: "#ffffff59", rest: "#ffffff1f" }) as const;

export const TaskBar = ({ progress }: { readonly progress: ConstellationProgress }) => {
  const styles = useStyles();
  const segmentColor = segmentColorOf(useTheme().colours);

  return (
    <View style={styles.bar}>
      {sevenSegments(progress).map((segment, index) => (
        <View key={index} style={[styles.segment, { backgroundColor: segmentColor[segment] }]} />
      ))}
    </View>
  );
};

export const ConstellationListRow = ({
  row,
  progress,
  now,
  onOpen,
}: {
  readonly row: ConstellationRow;
  readonly progress: ConstellationProgress | null;
  readonly now: number;
  readonly onOpen: () => void;
}) => {
  const styles = useStyles();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      style={[styles.listRow, row.stale ? styles.stale : null]}
    >
      <ConstellationTile />
      <View style={[styles.text, styles.constellationText]}>
        <Text style={styles.listTitle} numberOfLines={1}>
          {row.constellation.name}
        </Text>
        <View style={styles.progress}>
          {progress === null ? null : <TaskBar progress={progress} />}
          <Text style={styles.second} numberOfLines={1}>
            {progressLine(progress)}
          </Text>
        </View>
      </View>
      <Text style={styles.age}>{age(row.since, now)}</Text>
    </Pressable>
  );
};

const useStyles = themedStyles((colours) => ({
  needsYou: {
    borderTopWidth: 1,
    borderTopColor: colours.hairline,
    paddingVertical: 12,
    gap: 8,
  },
  firstNeedsYou: { borderTopWidth: 0, paddingTop: 2 },
  needsYouHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  index: { ...mobileType.index, color: colours.textFaint, width: 20 },
  text: { flex: 1, minWidth: 0, gap: 1 },
  needsYouTitle: { ...mobileType.title, color: colours.textStrong },
  second: { ...mobileType.footnote, color: colours.textSubtle },
  age: {
    ...mobileType.footnote,
    lineHeight: 16,
    color: colours.textFaint,
    fontVariant: ["tabular-nums"],
  },
  listRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 50, paddingLeft: 30 },
  recentRow: { minHeight: 52 },
  listTitle: { ...mobileType.heading, color: colours.textStrong },
  recentTitle: { color: colours.textDefault },
  constellationText: { gap: 4 },
  progress: { flexDirection: "row", alignItems: "center", gap: 8 },
  bar: { flexDirection: "row", gap: 3 },
  segment: { width: 10, height: 4 },
  stale: { opacity: 0.55 },
}));
