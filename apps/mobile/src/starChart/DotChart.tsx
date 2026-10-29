/** MX-X: past about 30 tasks, a row of 8pt dots per band in wave order, wrapping inside the row. */
import { mobileFont } from "@polaris/ui/tokens";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { CHROME_TEXT_SCALE } from "../theme/textScale.ts";
import { themedStyles, useTheme } from "../theme/index.ts";
import { fillOf, WorkingField } from "./glyph.tsx";
import { DOTS, dotRows, GEOMETRY, taskCode } from "./layout.ts";
import type { StarBand, StarTask } from "./types.ts";

const DOT = DOTS.size;

/** The tap target spills into the gap between dots. */
const HIT = { top: 4, bottom: 4, left: 3, right: 3 } as const;

interface Props {
  readonly tasks: ReadonlyArray<StarTask>;
  readonly bands: ReadonlyArray<StarBand>;
  readonly selectedTaskId: string | null;
  readonly onPressTask: ((taskId: string) => void) | undefined;
}

export const DotChart = ({ tasks, bands, selectedTaskId, onPressTask }: Props) => {
  const styles = useStyles();
  const rows = useMemo(() => dotRows(tasks, bands), [tasks, bands]);

  return (
    <View style={styles.rows}>
      {rows.map((row) => (
        <View key={row.band.id} style={styles.row}>
          <View style={styles.badge}>
            <Text style={styles.letter} maxFontSizeMultiplier={CHROME_TEXT_SCALE}>
              {row.band.letter}
            </Text>
          </View>
          <View style={styles.dots}>
            {row.tasks.map((task) => (
              <Pressable
                key={task.id}
                accessibilityRole="button"
                accessibilityLabel={`${taskCode(task, bands)}, ${task.label}, ${task.state}`}
                accessibilityState={{ selected: task.id === selectedTaskId }}
                disabled={onPressTask === undefined}
                hitSlop={HIT}
                onPress={() => onPressTask?.(task.id)}
              >
                <Dot task={task} selected={task.id === selectedTaskId} />
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
};

const Dot = ({ task, selected }: { readonly task: StarTask; readonly selected: boolean }) => {
  const { colours } = useTheme();
  const styles = useStyles();
  const ring = selected ? styles.selected : null;

  if (task.state === "working")
    return (
      <View style={[styles.dot, styles.workingGround, ring]}>
        <WorkingField size={DOT} colours={colours} />
      </View>
    );

  if (task.state === "waiting") return <View style={[styles.dot, styles.waiting, ring]} />;

  return <View style={[styles.dot, { backgroundColor: fillOf(task.state, colours) }, ring]} />;
};

const useStyles = themedStyles((colours) => ({
  rows: { gap: DOTS.rowGap },
  row: { flexDirection: "row", alignItems: "flex-start", gap: DOTS.badgeGap },
  badge: {
    width: GEOMETRY.badge,
    height: GEOMETRY.badge,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colours.raised,
  },
  letter: { fontFamily: mobileFont.mono, fontSize: 10, lineHeight: 12, color: colours.textSubtle },
  dots: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: DOTS.gap, paddingTop: DOTS.inset },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, overflow: "hidden" },
  // White at 30% over the panel (Paper MX-X's #4B4C4F on Midnight), under the dither.
  workingGround: { backgroundColor: `${colours.textDefault}4d` },
  waiting: { borderWidth: 1, borderColor: colours.textFaint },
  selected: { outlineWidth: 1.5, outlineColor: colours.textStrong, outlineOffset: 1.5 },
}));
