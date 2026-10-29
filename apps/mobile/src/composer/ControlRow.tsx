/**
 * The one row under the composer's input (Paper MX-E): the harness and model chip, the running
 * Subagents' moons with a count, the context ring, attach, mic, and Send (Stop while working).
 */
import type { CelestialBody, HarnessKind } from "@polaris/protocol";
import { mobileType } from "@polaris/ui/tokens";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { Celestial, sessionCelestial, subagentMoon } from "../celestial";
import { useTheme } from "../theme";
import { CONTROL_TEXT_SCALE } from "../theme/textScale.ts";
import { type ContextRing as Ring, litSegments, type Moons, RING_SEGMENTS } from "./controlRow.ts";

const Chevron = ({ colour }: { readonly colour: string }) => (
  <Svg width={10} height={10} viewBox="0 0 10 10">
    <Path
      d="M2 3.5l3 3 3-3"
      fill="none"
      stroke={colour}
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const ModelChip = ({
  harness,
  celestial,
  label,
  working,
  onPress,
}: {
  readonly harness: HarnessKind;
  readonly celestial: CelestialBody | null;
  readonly label: string;
  readonly working: boolean;
  /** Opens the model sheet; null where the Host can't be reached. */
  readonly onPress: (() => void) | null;
}) => {
  const { colours } = useTheme();

  return (
    <Pressable
      onPress={onPress ?? undefined}
      disabled={onPress === null}
      accessibilityRole="button"
      accessibilityLabel={`Model: ${label}`}
      accessibilityHint="Choose the harness, model, effort and permissions"
      style={[styles.chip, { backgroundColor: colours.raised, borderColor: colours.hairline }]}
    >
      <Celestial body={sessionCelestial(celestial)} harness={harness} size={16} working={working} />
      <Text
        style={[styles.chipLabel, { color: colours.textDefault }]}
        numberOfLines={1}
        maxFontSizeMultiplier={CONTROL_TEXT_SCALE}
      >
        {label}
      </Text>
      <Chevron colour={colours.textFaint} />
    </Pressable>
  );
};

export const SubagentMoons = ({
  harness,
  moons,
  shown,
}: {
  readonly harness: HarnessKind;
  readonly moons: Moons;
  /** How many moons the row has room for; the count still says them all. */
  readonly shown: number;
}) => {
  const { colours } = useTheme();

  if (moons.running === 0) return null;

  return (
    <View
      style={styles.moons}
      accessible
      accessibilityLabel={`${moons.running} ${moons.running === 1 ? "subagent" : "subagents"} running`}
    >
      <View style={styles.moonRow}>
        {moons.moons.slice(0, shown).map((moon) => (
          <Celestial
            key={moon.id}
            body={subagentMoon(moon.index)}
            harness={harness}
            size={16}
            working
          />
        ))}
      </View>
      <Text
        style={[styles.count, { color: colours.textSubtle }]}
        maxFontSizeMultiplier={CONTROL_TEXT_SCALE}
      >
        {moons.running}
      </Text>
    </View>
  );
};

const RADIUS = 7;

const CENTRE = 9;

const SEGMENT = 360 / RING_SEGMENTS;

const GAP = 3.44;

const point = (degrees: number) => {
  const radians = (degrees * Math.PI) / 180;

  return `${(CENTRE + RADIUS * Math.sin(radians)).toFixed(2)} ${(CENTRE - RADIUS * Math.cos(radians)).toFixed(2)}`;
};

/** MX-E's ring: twenty arcs clockwise from the top, lit by the share of the window in use. */
const RING_PATHS = Array.from(
  { length: RING_SEGMENTS },
  (_, i) =>
    `M${point(i * SEGMENT + GAP)}A${RADIUS} ${RADIUS} 0 0 1 ${point((i + 1) * SEGMENT - GAP)}`
);

export const ContextRing = ({
  ring,
  words,
}: {
  readonly ring: Ring;
  /** "17%" beside the ring, where the row has room; VoiceOver hears it either way. */
  readonly words: boolean;
}) => {
  const { colours } = useTheme();
  const lit = litSegments(ring.share);

  return (
    <View
      style={styles.ring}
      accessible
      accessibilityLabel={
        ring.words === "—" ? "Context usage not reported yet" : `Context ${ring.words}`
      }
    >
      <Svg width={18} height={18} viewBox="0 0 18 18">
        {RING_PATHS.map((d, i) => (
          <Path
            key={d}
            d={d}
            fill="none"
            stroke={ring.nearlyFull && i < lit ? colours.needsYou : colours.textDefault}
            strokeOpacity={i < lit ? 1 : 0.15}
            strokeWidth={2}
          />
        ))}
      </Svg>
      {words ? (
        <Text
          style={[styles.ringWords, { color: colours.textFaint }]}
          maxFontSizeMultiplier={CONTROL_TEXT_SCALE}
        >
          {ring.words}
        </Text>
      ) : null}
    </View>
  );
};

const Arrow = ({ colour }: { readonly colour: string }) => (
  <Svg width={16} height={16} viewBox="0 0 16 16">
    <Path
      d="M8 13V3M3.8 7.2L8 3l4.2 4.2"
      fill="none"
      stroke={colour}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

/** Send filled in Starlight (rule/starlight-is-rare), or Stop while a Turn works and the field is empty. */
export const SendButton = ({
  stop,
  disabled,
  label,
  onPress,
}: {
  readonly stop: boolean;
  readonly disabled: boolean;
  readonly label: string;
  readonly onPress: () => void;
}) => {
  const { colours } = useTheme();
  let face: ReactNode = <Arrow colour={colours.bg} />;

  if (stop) face = <View style={[styles.stopSquare, { backgroundColor: colours.textStrong }]} />;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={stop ? "Stop" : label}
      hitSlop={4}
      style={[
        styles.send,
        { backgroundColor: stop ? colours.fillSelected : colours.starlight },
        disabled ? styles.dim : null,
      ]}
    >
      {face}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 32,
    paddingLeft: 8,
    paddingRight: 10,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "100%",
  },
  chipLabel: { ...mobileType.footnote, lineHeight: 16, fontWeight: "500", flexShrink: 1 },
  moons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 32,
    paddingHorizontal: 2,
  },
  moonRow: { flexDirection: "row", gap: 0 },
  count: { ...mobileType.index, fontSize: 13, fontWeight: "500" },
  ring: { flexDirection: "row", alignItems: "center", gap: 4 },
  ringWords: { ...mobileType.index, fontSize: 11, lineHeight: 14 },
  send: {
    flexShrink: 0,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  stopSquare: { width: 10, height: 10, borderRadius: 2 },
  dim: { opacity: 0.4 },
});
