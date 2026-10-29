/**
 * The rail's glyphs (DESIGN.md, Rail glyphs; Paper C2), in plain Views: the working dither in
 * the Harness hue, rings, dots and the gate's square. Colour always comes with a shape.
 */
import type { HarnessKind } from "@polaris/protocol";
import type { ReactElement } from "react";
import { View } from "react-native";
import { Dither } from "../dither/index.ts";
import { type MobileColours, themedStyles, useTheme } from "../theme/index.ts";
import type { Tone } from "./model.ts";

/** A 10pt field needs a denser dither than a session tile to read as working (Paper C1). */
const RAIL_DITHER = 0.9;

export const harnessHue = (colours: MobileColours, harness: HarnessKind | null): string => {
  if (harness === "claude") return colours.harnessClaudeCode;

  if (harness === "codex") return colours.harnessCodex;

  return harness === "opencode" ? colours.harnessOpencode : colours.textSubtle;
};

/** A segment's colour in the task bar. */
export const segmentColour = (
  colours: MobileColours,
  tone: Tone,
  harness: HarnessKind | null = null
): string => {
  const byTone: Readonly<Record<Tone, string>> = {
    done: colours.accepted,
    working: harnessHue(colours, harness),
    review: colours.textDefault,
    "needs-you": colours.needsYou,
    blocked: colours.textSubtle,
    failed: colours.failed,
    waiting: colours.fillSelected,
    ended: colours.fillSelected,
  };

  return byTone[tone];
};

const Ring = ({ colour, dot, bar }: { colour: string; dot?: boolean; bar?: boolean }) => {
  const styles = useStyles();

  return (
    <View style={[styles.ring, { borderColor: colour }]}>
      {dot === true ? <View style={[styles.centre, { backgroundColor: colour }]} /> : null}
      {bar === true ? <View style={[styles.bar, { backgroundColor: colour }]} /> : null}
    </View>
  );
};

const Dot = ({ colour, hollow }: { readonly colour: string; readonly hollow?: boolean }) => {
  const styles = useStyles();
  const { colours } = useTheme();

  return (
    <View
      style={[
        styles.dot,
        hollow === true
          ? { borderColor: colour, borderWidth: 1.5, backgroundColor: colours.ground }
          : { backgroundColor: colour },
      ]}
    />
  );
};

const Square = ({ colour, filled }: { readonly colour: string; readonly filled: boolean }) => {
  const styles = useStyles();
  const { colours } = useTheme();

  return (
    <View
      style={[
        styles.square,
        { borderColor: colour, backgroundColor: filled ? colour : colours.ground },
      ]}
    />
  );
};

export interface GlyphProps {
  readonly tone: Tone;
  readonly harness: HarnessKind | null;
  readonly gate: boolean;
}

/** A task's glyph in its 16px lane; the lane's ground breaks the rail line. */
export const TaskGlyph = ({ tone, harness, gate }: GlyphProps) => {
  const styles = useStyles();
  const { colours } = useTheme();

  const glyph = (() => {
    if (tone === "needs-you") return <Ring colour={colours.needsYou} dot />;

    if (gate)
      return (
        <Square
          colour={tone === "done" ? colours.accepted : colours.textSubtle}
          filled={tone === "done"}
        />
      );

    const glyphs: Readonly<Record<Tone, ReactElement>> = {
      working:
        harness === null ? (
          <Ring colour={colours.textSubtle} />
        ) : (
          <Dither color={harnessHue(colours, harness)} size={10} moving intensity={RAIL_DITHER} />
        ),
      review: <Ring colour={colours.textDefault} dot />,
      blocked: <Ring colour={colours.textSubtle} bar />,
      done: <Dot colour={colours.accepted} />,
      failed: <Dot colour={colours.failed} />,
      waiting: <Dot colour={colours.textFaint} hollow />,
      ended: <Dot colour={colours.textFaint} hollow />,
      "needs-you": <Ring colour={colours.needsYou} dot />,
    };

    return glyphs[tone];
  })();

  return <View style={styles.lane}>{glyph}</View>;
};

/** A group's glyph: filled once every task in it is done, hollow while work remains. */
export const GroupGlyph = ({ finished }: { readonly finished: boolean }) => {
  const styles = useStyles();
  const { colours } = useTheme();

  return (
    <View style={styles.groupLane}>
      {finished ? <Dot colour={colours.accepted} /> : <Dot colour={colours.textFaint} hollow />}
    </View>
  );
};

/** A gate's dependencies as small dots, then an arrow into the gate. */
export const GateDeps = ({ deps }: { readonly deps: ReadonlyArray<Tone> }) => {
  const styles = useStyles();
  const { colours } = useTheme();

  return (
    <View style={styles.deps}>
      {deps.map((tone, i) =>
        tone === "done" ? (
          <View key={i} style={[styles.depDot, { backgroundColor: colours.accepted }]} />
        ) : (
          <View
            key={i}
            style={[
              styles.depDot,
              {
                borderWidth: 1.5,
                borderColor: tone === "needs-you" ? colours.needsYou : colours.textFaint,
              },
            ]}
          />
        )
      )}
      <View style={styles.arrow} />
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  lane: {
    width: 16,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colours.ground,
  },
  groupLane: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colours.ground,
  },
  ring: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  centre: { width: 4, height: 4, borderRadius: 2 },
  bar: { position: "absolute", width: 8, height: 1.5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  square: { width: 9, height: 9, borderWidth: 1.5 },
  deps: { flexDirection: "row", alignItems: "center", gap: 3 },
  depDot: { width: 6, height: 6, borderRadius: 3 },
  arrow: { width: 10, height: 1.2, marginLeft: 2, backgroundColor: colours.textFaint },
}));
