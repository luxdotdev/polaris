/**
 * The Risk Summary hero (Paper MX-N): the reviewer tile, "Read N files at <sha> · <age>", the
 * severity readout that pages between findings, and the walkthrough's line, which opens MX-U.
 */
import type { RiskSummary, Severity } from "@polaris/protocol";
import { mobileType } from "@polaris/ui/tokens";
import { Image, type LayoutChangeEvent, Pressable, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import polarisMark from "../../../assets/review/polaris.png";
import { themedStyles, useTheme } from "../../theme/index.ts";
import { CONTENT_TEXT_SCALE } from "../../theme/textScale.ts";
import { summaryCaption } from "../copy.ts";
import type { Tally } from "../model.ts";
import type { PagerPositions } from "./pager.ts";
import { SeverityPager } from "./Pager.tsx";
import { walkthroughLine } from "./walkthrough.ts";

export interface HeroProps {
  readonly summary: RiskSummary | null;
  readonly fileCount: number;
  readonly counts: Tally;
  readonly positions: PagerPositions;
  readonly onPage: (severity: Severity) => void;
  readonly onWalkthrough: () => void;
  /** Where the readout ends inside the hero, for pinning the pager once it scrolls away. */
  readonly onReadoutLayout: (bottom: number) => void;
}

const Lines = ({ colour }: { readonly colour: string }) => (
  <Svg width={14} height={14} viewBox="0 0 14 14">
    <Path d="M2 3h10M2 7h7M2 11h9" stroke={colour} strokeWidth={1.5} strokeLinecap="round" />
  </Svg>
);

const Chevron = ({ colour }: { readonly colour: string }) => (
  <Svg width={8} height={12} viewBox="0 0 8 12">
    <Path d="M2 2l4 4-4 4" fill="none" stroke={colour} strokeWidth={1.5} strokeLinecap="round" />
  </Svg>
);

const Walkthrough = ({
  summary,
  onPress,
}: {
  readonly summary: RiskSummary | null;
  readonly onPress: () => void;
}) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const line = walkthroughLine(summary);

  if (line === null) return null;
  const opens = line.groups !== null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !opens }}
      disabled={!opens}
      onPress={onPress}
      style={({ pressed }) => [styles.walkthrough, pressed && styles.pressed]}
    >
      <Lines colour={colours.textSubtle} />
      <Text
        maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
        numberOfLines={1}
        style={[styles.walkthroughText, !opens && styles.quiet]}
      >
        {line.text}
      </Text>
      {opens ? <Chevron colour={colours.textFaint} /> : null}
    </Pressable>
  );
};

export const Hero = (props: HeroProps) => {
  const styles = useStyles();

  const onReadout = ({ nativeEvent }: LayoutChangeEvent) =>
    props.onReadoutLayout(nativeEvent.layout.y + nativeEvent.layout.height);

  return (
    <View style={styles.hero}>
      <View style={styles.head}>
        <View style={styles.tile}>
          <Image source={polarisMark} style={styles.mark} />
        </View>
        <View style={styles.titles}>
          <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.title}>
            Risk summary
          </Text>
          <Text maxFontSizeMultiplier={CONTENT_TEXT_SCALE} style={styles.caption}>
            {summaryCaption(props.summary, props.fileCount, Date.now())}
          </Text>
        </View>
      </View>
      <View onLayout={onReadout}>
        <SeverityPager counts={props.counts} positions={props.positions} onPage={props.onPage} />
      </View>
      <Walkthrough summary={props.summary} onPress={props.onWalkthrough} />
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  hero: {
    gap: 12,
    padding: 14,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.raised,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  tile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: `${colours.starlight}38`,
    backgroundColor: `${colours.starlight}1f`,
    alignItems: "center",
    justifyContent: "center",
  },
  mark: { width: 18, height: 18 },
  titles: { flex: 1, gap: 1, minWidth: 0 },
  title: { ...mobileType.heading, color: colours.textStrong },
  caption: { ...mobileType.footnote, color: colours.textSubtle },
  walkthrough: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.well,
  },
  walkthroughText: { ...mobileType.subhead, flex: 1, color: colours.textDefault },
  quiet: { color: colours.textSubtle },
  pressed: { opacity: 0.7 },
}));
