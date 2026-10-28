/**
 * The rail's glyphs (DESIGN.md, Rail glyphs; Paper C2), in plain Views: the working dither in
 * the Harness hue, rings, dots and the gate's square. Colour always comes with a shape.
 */
import type { HarnessKind } from "@polaris/protocol";
import { midnight } from "@polaris/ui/tokens";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { Dither } from "../dither/index.ts";
import type { Tone } from "./model.ts";

/** A 10pt field needs a denser dither than a session tile to read as working (Paper C1). */
const RAIL_DITHER = 0.9;

export const harnessHue = (harness: HarnessKind | null): string => {
  if (harness === "claude") return midnight.harnessClaudeCode;

  if (harness === "codex") return midnight.harnessCodex;

  return harness === "opencode" ? midnight.harnessOpencode : midnight.textSubtle;
};

/** A segment's colour in the task bar. */
export const segmentColour = (tone: Tone, harness: HarnessKind | null = null): string => {
  const colours: Readonly<Record<Tone, string>> = {
    done: midnight.accepted,
    working: harnessHue(harness),
    review: midnight.textDefault,
    "needs-you": midnight.needsYou,
    blocked: midnight.textSubtle,
    failed: midnight.failed,
    waiting: midnight.fillSelected,
    ended: midnight.fillSelected,
  };

  return colours[tone];
};

const Ring = ({ colour, dot, bar }: { colour: string; dot?: boolean; bar?: boolean }) => (
  <View style={[styles.ring, { borderColor: colour }]}>
    {dot === true ? <View style={[styles.centre, { backgroundColor: colour }]} /> : null}
    {bar === true ? <View style={[styles.bar, { backgroundColor: colour }]} /> : null}
  </View>
);

const Dot = ({ colour, hollow }: { readonly colour: string; readonly hollow?: boolean }) => (
  <View
    style={[
      styles.dot,
      hollow === true
        ? { borderColor: colour, borderWidth: 1.5, backgroundColor: midnight.bg }
        : { backgroundColor: colour },
    ]}
  />
);

const Square = ({ colour, filled }: { readonly colour: string; readonly filled: boolean }) => (
  <View
    style={[styles.square, { borderColor: colour, backgroundColor: filled ? colour : midnight.bg }]}
  />
);

export interface GlyphProps {
  readonly tone: Tone;
  readonly harness: HarnessKind | null;
  readonly gate: boolean;
}

/** A task's glyph in its 16px lane; the lane's black ground breaks the rail line. */
export const TaskGlyph = ({ tone, harness, gate }: GlyphProps) => {
  const glyph = (() => {
    if (tone === "needs-you") return <Ring colour={midnight.needsYou} dot />;

    if (gate)
      return (
        <Square
          colour={tone === "done" ? midnight.accepted : midnight.textSubtle}
          filled={tone === "done"}
        />
      );

    const glyphs: Readonly<Record<Tone, ReactElement>> = {
      working:
        harness === null ? (
          <Ring colour={midnight.textSubtle} />
        ) : (
          <Dither color={harnessHue(harness)} size={10} moving intensity={RAIL_DITHER} />
        ),
      review: <Ring colour={midnight.textDefault} dot />,
      blocked: <Ring colour={midnight.textSubtle} bar />,
      done: <Dot colour={midnight.accepted} />,
      failed: <Dot colour={midnight.failed} />,
      waiting: <Dot colour={midnight.textFaint} hollow />,
      ended: <Dot colour={midnight.textFaint} hollow />,
      "needs-you": <Ring colour={midnight.needsYou} dot />,
    };

    return glyphs[tone];
  })();

  return <View style={styles.lane}>{glyph}</View>;
};

/** A group's glyph: filled once every task in it is done, hollow while work remains. */
export const GroupGlyph = ({ finished }: { readonly finished: boolean }) => (
  <View style={styles.groupLane}>
    {finished ? <Dot colour={midnight.accepted} /> : <Dot colour={midnight.textFaint} hollow />}
  </View>
);

/** A gate's dependencies as small dots, then an arrow into the gate. */
export const GateDeps = ({ deps }: { readonly deps: ReadonlyArray<Tone> }) => (
  <View style={styles.deps}>
    {deps.map((tone, i) =>
      tone === "done" ? (
        <View key={i} style={[styles.depDot, { backgroundColor: midnight.accepted }]} />
      ) : (
        <View
          key={i}
          style={[
            styles.depDot,
            {
              borderWidth: 1.5,
              borderColor: tone === "needs-you" ? midnight.needsYou : midnight.textFaint,
            },
          ]}
        />
      )
    )}
    <View style={styles.arrow} />
  </View>
);

const styles = StyleSheet.create({
  lane: {
    width: 16,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: midnight.bg,
  },
  groupLane: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: midnight.bg,
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
  arrow: { width: 10, height: 1.2, marginLeft: 2, backgroundColor: midnight.textFaint },
});
