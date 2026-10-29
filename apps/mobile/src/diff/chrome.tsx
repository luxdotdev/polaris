/**
 * The full-screen diff's chrome (Paper MX-Q, MX-R): the back button, the file's name and counts,
 * the hunk stepper, the per-file progress bar, page dots, and the pager pill between files.
 */
import type { Severity } from "@polaris/protocol";
import { mobileType } from "@polaris/ui/tokens";
import { Pressable, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import type { DiffFileInput } from "../review/diffRows.ts";
import { SeverityGlyph } from "../review/severity.tsx";
import { themedStyles, useTheme } from "../theme/index.ts";
import { CHROME_TEXT_SCALE } from "../theme/textScale.ts";
import { grouped } from "../home/model/format.ts";

/** `src/artifact/upload.ts` as its directory (with the slash) and its name. */
export interface SplitPath {
  readonly dir: string;
  readonly name: string;
}

export const splitPath = (path: string): SplitPath => {
  const cut = path.lastIndexOf("/");

  return { dir: path.slice(0, cut + 1), name: path.slice(cut + 1) };
};

/** "file 2 of 3"; MX-R's header sets it in capitals. */
export const fileOf = (index: number, count: number): string => `file ${index + 1} of ${count}`;

/** Up to `max` page indexes around `index`, so many files still fit a row of dots. */
export const dotWindow = (index: number, count: number, max = 7): ReadonlyArray<number> => {
  const size = Math.min(max, count);
  const start = Math.min(Math.max(0, index - Math.floor(size / 2)), count - size);

  return Array.from({ length: size }, (_, i) => start + i);
};

const Chevron = ({ d, colour, size = 12 }: { d: string; colour: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 12 12">
    <Path
      d={d}
      fill="none"
      stroke={colour}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

const LEFT = "M8 2L4 6l4 4";

const RIGHT = "M4 2l4 4-4 4";

export const BackButton = ({
  onPress,
  size,
}: {
  onPress?: (() => void) | undefined;
  size: number;
}) => {
  const styles = useStyles();
  const { colours } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      onPress={onPress}
      style={[styles.circle, { width: size, height: size }]}
    >
      <Svg width={10} height={16} viewBox="0 0 10 16">
        <Path
          d="M7.5 2L2 8l5.5 6"
          fill="none"
          stroke={colours.textStrong}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </Pressable>
  );
};

export const Counts = ({ file }: { readonly file: DiffFileInput }) => {
  const styles = useStyles();
  const { colours } = useTheme();

  return (
    <>
      <Text
        style={[styles.count, { color: colours.diffAddedText }]}
        maxFontSizeMultiplier={CHROME_TEXT_SCALE}
      >
        +{grouped(file.added)}
      </Text>
      <Text
        style={[styles.count, { color: colours.diffRemovedText }]}
        maxFontSizeMultiplier={CHROME_TEXT_SCALE}
      >
        −{grouped(file.removed)}
      </Text>
    </>
  );
};

/** The previous and next hunk, as MX-Q's chevron pill. */
export const HunkStepper = ({ onStep }: { readonly onStep: (direction: 1 | -1) => void }) => {
  const styles = useStyles();
  const { colours } = useTheme();

  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Previous hunk"
        style={styles.step}
        onPress={() => onStep(-1)}
      >
        <Chevron d="M2 8l4-4 4 4" colour={colours.textDefault} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next hunk"
        style={styles.step}
        onPress={() => onStep(1)}
      >
        <Chevron d="M2 4l4 4 4-4" colour={colours.textDefault} />
      </Pressable>
    </View>
  );
};

/** One segment per file, as wide as its share of the changed lines; the open one lit. */
export const Progress = ({
  files,
  index,
}: {
  files: ReadonlyArray<DiffFileInput>;
  index: number;
}) => {
  const styles = useStyles();

  return (
    <View style={styles.progress}>
      {files.map((file, i) => (
        <View
          key={file.diff.name}
          style={[
            styles.segment,
            { flexGrow: Math.max(1, file.added + file.removed) },
            i === index ? null : styles.unlit,
          ]}
        />
      ))}
    </View>
  );
};

export const Dots = ({ index, count }: { readonly index: number; readonly count: number }) => {
  const styles = useStyles();

  return (
    <View style={styles.dots}>
      {dotWindow(index, count).map((i) => (
        <View key={i} style={[styles.dot, i === index ? styles.dotOn : styles.unlit]} />
      ))}
    </View>
  );
};

/** "▲ 1 finding" in the most severe finding's glyph, for MX-R's header. */
export const FindingCount = ({ count, top }: { count: number; top: Severity | null }) => {
  const styles = useStyles();

  if (top === null) return null;

  return (
    <View style={styles.findingCount}>
      <SeverityGlyph severity={top} size={10} />
      <Text style={styles.findingText} maxFontSizeMultiplier={CHROME_TEXT_SCALE}>
        {count === 1 ? "1 finding" : `${count} findings`}
      </Text>
    </View>
  );
};

const PagerEnd = ({
  name,
  side,
  onPress,
}: {
  readonly name: string | undefined;
  readonly side: "previous" | "next";
  readonly onPress: () => void;
}) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const next = side === "next";

  if (name === undefined) return <View style={styles.end} />;
  const colour = next ? colours.textDefault : colours.textSubtle;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${next ? "Next" : "Previous"} file, ${name}`}
      onPress={onPress}
      style={[styles.end, next && styles.endNext]}
    >
      {next ? null : <Chevron d={LEFT} colour={colour} />}
      <Text
        style={[styles.endText, { color: colour }]}
        numberOfLines={1}
        ellipsizeMode="middle"
        maxFontSizeMultiplier={CHROME_TEXT_SCALE}
      >
        {name}
      </Text>
      {next ? <Chevron d={RIGHT} colour={colour} /> : null}
    </Pressable>
  );
};

/** MX-Q's pill at the foot: the previous file's name, the dots, the next file's name. */
export const FilePager = ({
  files,
  index,
  onGo,
}: {
  readonly files: ReadonlyArray<DiffFileInput>;
  readonly index: number;
  readonly onGo: (index: number) => void;
}) => {
  const styles = useStyles();

  const name = (i: number) => {
    const file = files[i];

    return file === undefined ? undefined : splitPath(file.diff.name).name;
  };

  return (
    <View style={styles.pager}>
      <PagerEnd name={name(index - 1)} side="previous" onPress={() => onGo(index - 1)} />
      <Dots index={index} count={files.length} />
      <PagerEnd name={name(index + 1)} side="next" onPress={() => onGo(index + 1)} />
    </View>
  );
};

/** The tab on the right edge that says another file waits a swipe away. */
export const EdgeTab = ({ onPress }: { readonly onPress: () => void }) => {
  const styles = useStyles();
  const { colours } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Next file"
      onPress={onPress}
      style={styles.edge}
    >
      <Chevron d={RIGHT} colour={colours.textSubtle} />
    </Pressable>
  );
};

const kicker = { ...mobileType.index, fontSize: 11, lineHeight: 14 } as const;

const useStyles = themedStyles((colours) => ({
  circle: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.panel,
  },
  count: { ...mobileType.index },
  stepper: {
    flexDirection: "row",
    gap: 2,
    padding: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.panel,
  },
  step: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  progress: { flexDirection: "row", gap: 4, paddingHorizontal: 16, paddingBottom: 10 },
  segment: { flexBasis: 0, height: 3, borderRadius: 2, backgroundColor: colours.textStrong },
  unlit: { opacity: 0.2 },
  dots: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colours.textStrong },
  dotOn: { width: 14 },
  findingCount: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4 },
  findingText: { ...mobileType.footnote, color: colours.textSubtle },
  pager: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    height: 48,
    paddingHorizontal: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.panel,
  },
  end: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 36,
    maxWidth: "40%",
    minWidth: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  endNext: { backgroundColor: colours.raised },
  endText: { ...mobileType.index, flexShrink: 1 },
  edge: {
    position: "absolute",
    right: 0,
    top: "63%",
    width: 18,
    height: 150,
    alignItems: "center",
    justifyContent: "center",
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
    borderWidth: 1,
    borderRightWidth: 0,
    borderColor: colours.hairline,
    backgroundColor: colours.panel,
  },
  kicker: { ...kicker, color: colours.textFaint },
}));
