/**
 * The horizon (DESIGN.md, Mobile App): a thin pixel ridge at the foot of Home, lit for the time
 * of day, with the list fading into the ground above it so no legible row ever sits on the scene.
 */
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Svg, { Defs, Ellipse, RadialGradient, Stop } from "react-native-svg";
import { type MobileColours, themedStyles, useTheme } from "../../theme/index.ts";

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

const starsOf = (
  colours: MobileColours
): ReadonlyArray<readonly [number, number, string, number]> => [
  [38, 44, colours.starlight, 0.55],
  [87, 68, "#ffffff", 0.35],
  [131, 32, colours.starlight, 0.4],
  [166, 78, "#ffffff", 0.25],
  [247, 56, "#ffffff", 0.3],
  [289, 26, colours.starlight, 0.5],
  [352, 72, "#ffffff", 0.3],
  [377, 40, colours.starlight, 0.35],
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

/** "#rrggbbaa" as SVG's colour and opacity. */
const split = (hex: string) => ({
  color: hex.slice(0, 7),
  opacity: Number.parseInt(hex.slice(7, 9), 16) / 255,
});

/** The glow behind the ridge: soft light that fades to nothing at its edge, never a hard shape. */
const GlowLight = ({ width, glow }: { readonly width: number; readonly glow: Glow }) => {
  const layers = [
    { id: "halo", ...split(glow.halo), rx: width * 0.7, ry: 60 },
    { id: "core", ...split(glow.core), rx: width * 0.38, ry: 34 },
  ];

  return (
    <Svg style={StyleSheet.absoluteFill} width={width} height={HORIZON_HEIGHT}>
      <Defs>
        {layers.map((layer) => (
          <RadialGradient key={layer.id} id={layer.id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={layer.color} stopOpacity={layer.opacity} />
            <Stop offset="0.55" stopColor={layer.color} stopOpacity={layer.opacity * 0.45} />
            <Stop offset="1" stopColor={layer.color} stopOpacity={0} />
          </RadialGradient>
        ))}
      </Defs>
      {layers.map((layer) => (
        <Ellipse
          key={layer.id}
          cx={width / 2}
          cy={GLOW_CENTRE}
          rx={layer.rx}
          ry={layer.ry}
          fill={`url(#${layer.id})`}
        />
      ))}
    </Svg>
  );
};

/** Where the glow sits: just under the ridge, so it rises from behind it. */
const GLOW_CENTRE = 96;

/** Bands that step the list from clear to black over the top 32 points. */
const FADE_STEPS = 8;

export const Horizon = ({ hour }: { readonly hour: number }) => {
  const styles = useStyles();
  const { colours } = useTheme();
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
      <GlowLight width={width} glow={glow} />
      {starsOf(colours).map(([x, y, color, opacity]) => (
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

const useStyles = themedStyles((colours) => ({
  horizon: { position: "absolute", left: 0, bottom: 0, height: HORIZON_HEIGHT, overflow: "hidden" },
  band: { position: "absolute", left: 0, right: 0, height: 4, backgroundColor: colours.ground },
  solid: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colours.ground },
  star: { position: "absolute", width: 2, height: 2 },
  polaris: { position: "absolute", top: 55, width: 9, height: 9, opacity: 0.9 },
  polarisArm: {
    position: "absolute",
    width: 3,
    height: 3,
    backgroundColor: colours.starlight,
    opacity: 0.35,
  },
  polarisCore: { position: "absolute", width: 3, height: 3, backgroundColor: colours.starlight },
  ridgeEdge: { height: 3, backgroundColor: "#22305a" },
  ridgeFill: { flex: 1, backgroundColor: colours.ground },
}));
