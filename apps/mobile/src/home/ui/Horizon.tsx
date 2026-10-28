/**
 * The horizon (DESIGN.md, Mobile App): a thin pixel ridge at the foot of Home, lit for the time
 * of day, with the list fading to black above it so no legible row ever sits on the scene.
 */
import { midnight } from "@polaris/ui/tokens";
import { StyleSheet, useWindowDimensions, View } from "react-native";

export const HORIZON_HEIGHT = 200;

/** Paper H4's ridge on its 402-wide artboard: [from x, to x, top y] steps. */
const RIDGE: ReadonlyArray<readonly [number, number, number]> = [
  [0, 30, 93],
  [30, 51, 90],
  [51, 66, 87],
  [66, 78, 84],
  [78, 96, 87],
  [96, 120, 90],
  [120, 180, 93],
  [180, 195, 90],
  [195, 204, 87],
  [204, 210, 81],
  [210, 216, 78],
  [216, 222, 81],
  [222, 240, 87],
  [240, 270, 90],
  [270, 300, 93],
  [300, 330, 90],
  [330, 342, 87],
  [342, 357, 84],
  [357, 372, 87],
  [372, 402, 90],
];

const STARS: ReadonlyArray<readonly [number, number, string, number]> = [
  [38, 44, midnight.starlight, 0.55],
  [87, 68, "#ffffff", 0.35],
  [131, 32, midnight.starlight, 0.4],
  [166, 78, "#ffffff", 0.25],
  [247, 56, "#ffffff", 0.3],
  [289, 26, midnight.starlight, 0.5],
  [352, 72, "#ffffff", 0.3],
  [377, 40, midnight.starlight, 0.35],
];

export interface Glow {
  readonly core: string;
  readonly halo: string;
}

/** The glow over the ridge by hour: blue at night, warm at dawn and dusk, pale by day. */
export const glowFor = (hour: number): Glow => {
  if (hour >= 5 && hour < 8) return { core: "#e1a07857", halo: "#a5654626" };

  if (hour >= 8 && hour < 17) return { core: "#9db8e83d", halo: "#5f7fb81a" };

  if (hour >= 17 && hour < 20) return { core: "#c98a9a4d", halo: "#7a4a6a1f" };

  return { core: "#7896e157", halo: "#465fa51f" };
};

/** Bands that step the list from clear to black over the top 32 points. */
const FADE_STEPS = 8;

export const Horizon = ({ hour }: { readonly hour: number }) => {
  const { width } = useWindowDimensions();
  const scale = width / 402;
  const glow = glowFor(hour);

  return (
    <View pointerEvents="none" style={[styles.horizon, { width }]}>
      {Array.from({ length: FADE_STEPS }, (_, step) => (
        <View
          key={step}
          style={[styles.band, { top: step * 4, opacity: (step + 1) / (FADE_STEPS + 1) }]}
        />
      ))}
      <View style={[styles.solid, { top: FADE_STEPS * 4 }]} />
      <View
        style={[
          styles.glow,
          { backgroundColor: glow.halo, width: width * 1.1, left: -width * 0.05 },
        ]}
      />
      <View
        style={[
          styles.glow,
          styles.core,
          { backgroundColor: glow.core, width: width * 0.6, left: width * 0.2 },
        ]}
      />
      {STARS.map(([x, y, color, opacity]) => (
        <View
          key={`${x}:${y}`}
          style={[styles.star, { left: x * scale, top: y, backgroundColor: color, opacity }]}
        />
      ))}
      <View style={[styles.polaris, { left: 312 * scale }]}>
        <View style={[styles.polarisArm, { left: 3, top: 0 }]} />
        <View style={[styles.polarisArm, { left: 0, top: 3 }]} />
        <View style={[styles.polarisArm, { left: 6, top: 3 }]} />
        <View style={[styles.polarisArm, { left: 3, top: 6 }]} />
        <View style={[styles.polarisCore, { left: 3, top: 3 }]} />
      </View>
      {RIDGE.map(([from, to, top]) => (
        <View
          key={from}
          style={{
            position: "absolute",
            left: from * scale,
            width: (to - from) * scale + 0.5,
            top,
            bottom: 0,
          }}
        >
          <View style={styles.ridgeEdge} />
          <View style={styles.ridgeFill} />
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  horizon: { position: "absolute", left: 0, bottom: 0, height: HORIZON_HEIGHT, overflow: "hidden" },
  band: { position: "absolute", left: 0, right: 0, height: 4, backgroundColor: midnight.bg },
  solid: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: midnight.bg },
  glow: {
    position: "absolute",
    top: 40,
    height: 110,
    borderRadius: 999,
    transform: [{ scaleY: 0.6 }],
  },
  core: { top: 62, height: 66 },
  star: { position: "absolute", width: 2, height: 2 },
  polaris: { position: "absolute", top: 55, width: 9, height: 9, opacity: 0.9 },
  polarisArm: {
    position: "absolute",
    width: 3,
    height: 3,
    backgroundColor: midnight.starlight,
    opacity: 0.35,
  },
  polarisCore: { position: "absolute", width: 3, height: 3, backgroundColor: midnight.starlight },
  ridgeEdge: { height: 3, backgroundColor: "#22305a" },
  ridgeFill: { flex: 1, backgroundColor: midnight.bg },
});
