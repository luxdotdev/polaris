/**
 * An agent session's tile (Paper H4): the Harness's dithered wash with what the session is
 * doing on it, the raised hand when it needs you, the dither while it works, a dot when done.
 */
import type { SessionState } from "@polaris/protocol";
import { midnight } from "@polaris/ui/tokens";
import { Image, type ImageSourcePropType, StyleSheet, View } from "react-native";
import claudeWash from "../../../assets/tiles/claude.png";
import codexWash from "../../../assets/tiles/codex.png";
import { ConstellationGlyph, NeedsYouGlyph, WorkingDither } from "./glyphs.tsx";

interface Hue {
  readonly color: string;
  readonly wash: ImageSourcePropType | null;
}

const HUES = {
  claude: { color: midnight.harnessClaudeCode, wash: claudeWash },
  codex: { color: midnight.harnessCodex, wash: codexWash },
  opencode: { color: midnight.harnessOpencode, wash: null },
} satisfies Record<string, Hue>;

const isHarness = (harness: string): harness is keyof typeof HUES => Object.hasOwn(HUES, harness);

const hueOf = (harness: string): Hue =>
  isHarness(harness) ? HUES[harness] : { color: midnight.textSubtle, wash: null };

const WORKING: ReadonlySet<SessionState> = new Set(["starting", "working"]);

export const SessionTile = ({
  harness,
  state,
  needsYou,
}: {
  readonly harness: string;
  readonly state: SessionState;
  readonly needsYou: boolean;
}) => {
  const hue = hueOf(harness);
  const done = !needsYou && !WORKING.has(state);

  return (
    <View
      style={[
        styles.tile,
        { borderColor: `${hue.color}38`, opacity: done ? 0.7 : 1 },
        hue.wash === null ? { backgroundColor: `${hue.color}26` } : null,
      ]}
    >
      {hue.wash === null ? null : (
        <Image source={hue.wash} style={StyleSheet.absoluteFill} resizeMode="cover" />
      )}
      {needsYou ? <NeedsYouGlyph /> : null}
      {!needsYou && WORKING.has(state) ? (
        <WorkingDither color={hue.color} still={state === "starting"} />
      ) : null}
      {done ? (
        <View
          style={[
            styles.dot,
            { backgroundColor: state === "failed" ? midnight.failed : midnight.textDefault },
          ]}
        />
      ) : null}
    </View>
  );
};

export const ConstellationTile = () => (
  <View style={[styles.tile, styles.constellation]}>
    <ConstellationGlyph />
  </View>
);

const styles = StyleSheet.create({
  tile: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  constellation: { backgroundColor: midnight.surfaceSunken, borderColor: midnight.hairline },
  dot: { width: 7, height: 7, borderRadius: 999 },
});
