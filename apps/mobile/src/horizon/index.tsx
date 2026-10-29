/**
 * The horizon (DESIGN.md, Mobile chrome redesign): the shared pixel ridges, stars and Moonlit's moon
 * at the foot of a top-level screen, cropped to its width at 1:1, under a scroll-edge fade that
 * covers the content scrolling behind it. Static: no timers, no time-of-day lighting (as the Desktop).
 */
import { MOON, MOON_HALO, RIDGES } from "@polaris/ui/horizon";
import type { ReactNode } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Svg, { Defs, G, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { useTheme } from "../theme";
import {
  cropLeft,
  HORIZON_HEIGHT,
  MOON_TOP,
  moonLeft,
  PALETTES,
  RIDGE_TOP,
  SKY_TOP,
  splitHex,
  starsFor,
} from "./scene.ts";

export { HORIZON_HEIGHT } from "./scene.ts";

/** Scroll content's bottom padding: MX-C rests the last row 140pt up, clear of the tab pill and ridge. */
export const HORIZON_INSET = 140;

const Gradients = ({
  ground,
  glow,
}: {
  readonly ground: string;
  readonly glow: readonly [string, string];
}) => {
  const [foot, mid] = [splitHex(glow[0]), splitHex(glow[1])];

  return (
    <Defs>
      <LinearGradient id="hz-fade" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor={ground} stopOpacity={0} />
        <Stop offset="1" stopColor={ground} stopOpacity={1} />
      </LinearGradient>
      <LinearGradient id="hz-glow" x1="0" y1="1" x2="0" y2="0">
        <Stop offset="0" stopColor={foot.color} stopOpacity={foot.opacity} />
        <Stop offset="0.45" stopColor={mid.color} stopOpacity={mid.opacity} />
        <Stop offset="1" stopColor={mid.color} stopOpacity={0} />
      </LinearGradient>
    </Defs>
  );
};

const HALO = splitHex("#D9DEE833");

const Moon = ({ width }: { readonly width: number }) => (
  <G transform={`translate(${moonLeft(width)} ${MOON_TOP})`}>
    <Path d={MOON_HALO} fill={HALO.color} fillOpacity={HALO.opacity} />
    {MOON.map(([fill, d]) => (
      <Path key={fill} d={d} fill={fill} />
    ))}
  </G>
);

/** The scene alone, absolutely placed at its parent's foot; it takes no touches. */
export const Horizon = () => {
  const { width } = useWindowDimensions();
  const { name, colours } = useTheme();
  const palette = PALETTES[name];

  return (
    <View pointerEvents="none" style={[styles.horizon, { width }]}>
      <Svg width={width} height={HORIZON_HEIGHT}>
        <Gradients ground={colours.ground} glow={palette.glow} />
        <Rect width={width} height={HORIZON_HEIGHT} fill="url(#hz-fade)" />
        <Rect y={SKY_TOP} width={width} height={HORIZON_HEIGHT - SKY_TOP} fill="url(#hz-glow)" />
        <G transform={`translate(0 ${SKY_TOP})`}>
          {starsFor(name, width).map((star) => (
            <Rect
              key={`${star.x},${star.y}`}
              x={star.x}
              y={star.y}
              width={star.size}
              height={star.size}
              fill={palette.star}
              fillOpacity={star.opacity}
            />
          ))}
        </G>
        {palette.moon ? <Moon width={width} /> : null}
        <G transform={`translate(${-cropLeft(width)} ${RIDGE_TOP})`}>
          <Path d={RIDGES[0]} fill={palette.back} />
          <Path d={RIDGES[1]} fill={palette.front} />
        </G>
      </Svg>
    </View>
  );
};

/** A top-level screen on the ground with the horizon over its foot; pad scroll content by HORIZON_INSET. */
export const HorizonScreen = ({ children }: { readonly children: ReactNode }) => {
  const { colours } = useTheme();

  return (
    <View style={[styles.screen, { backgroundColor: colours.ground }]}>
      {children}
      <Horizon />
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  horizon: { position: "absolute", left: 0, bottom: 0, height: HORIZON_HEIGHT, overflow: "hidden" },
});
