/**
 * An agent session's tile (Paper H4): the Harness's dithered wash with what the session is
 * doing on it, the raised hand when it needs you, the dither while it works, a dot when done.
 */
import type { SessionState } from "@polaris/protocol";
import { DITHER_EXIT_MS } from "@polaris/ui/dither";
import { useExitPresence } from "@polaris/ui/presence";
import { Image, type ImageSourcePropType, StyleSheet, View } from "react-native";
import claudeWash from "../../../assets/tiles/claude.png";
import codexWash from "../../../assets/tiles/codex.png";
import { Dither } from "../../dither/index.ts";
import { type MobileColours, themedStyles, useTheme } from "../../theme/index.ts";
import { ConstellationGlyph, NeedsYouGlyph } from "./glyphs.tsx";

interface Hue {
  readonly color: string;
  readonly wash: ImageSourcePropType | null;
}

type Harness = "claude" | "codex" | "opencode";

const HARNESSES: ReadonlySet<string> = new Set<Harness>(["claude", "codex", "opencode"]);

const huesOf = (colours: MobileColours): Record<Harness, Hue> => ({
  claude: { color: colours.harnessClaudeCode, wash: claudeWash },
  codex: { color: colours.harnessCodex, wash: codexWash },
  opencode: { color: colours.harnessOpencode, wash: null },
});

const isHarness = (harness: string): harness is Harness => HARNESSES.has(harness);

const hueOf = (colours: MobileColours, harness: string): Hue =>
  isHarness(harness) ? huesOf(colours)[harness] : { color: colours.textSubtle, wash: null };

const WORKING: ReadonlySet<SessionState> = new Set(["starting", "working"]);

/** As the Desktop App's glyph in a tile over 28px (HarnessMark). */
const GLYPH = 16;

export const SessionTile = ({
  harness,
  state,
  needsYou,
}: {
  readonly harness: string;
  readonly state: SessionState;
  readonly needsYou: boolean;
}) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const hue = hueOf(colours, harness);
  const done = !needsYou && !WORKING.has(state);
  const working = !needsYou && state === "working";
  // One dither through Working and its 200ms exit, so a quick return resumes rather than replays.
  const leaving = useExitPresence(working, DITHER_EXIT_MS);

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
      {!needsYou && state === "starting" ? <Dither color={hue.color} size={GLYPH} dim /> : null}
      {done ? (
        <View
          style={[
            styles.dot,
            { backgroundColor: state === "failed" ? colours.failed : colours.textDefault },
          ]}
        />
      ) : null}
      {working || leaving ? (
        <View style={styles.overlay}>
          <Dither color={hue.color} size={GLYPH} moving leaving={!working} />
        </View>
      ) : null}
    </View>
  );
};

export const ConstellationTile = () => {
  const styles = useStyles();

  return (
    <View style={[styles.tile, styles.constellation]}>
      <ConstellationGlyph />
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  tile: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  constellation: { backgroundColor: colours.panel, borderColor: colours.hairline },
  dot: { width: 7, height: 7, borderRadius: 999 },
  overlay: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
}));
