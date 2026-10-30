/**
 * The Polaris star over the pairing sky (MX-AH): whole and in one place, only its light changes.
 * Linking twinkles its glow with the Working dither; linked brightens; failed dims.
 */
import { DITHER_FRAME_MS, DITHER_FRAMES } from "@polaris/ui/dither";
import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { ditherSteps } from "../dither/strip.ts";
import { useReducedMotion } from "../theme/index.ts";
import type { StarLight } from "./model.ts";
import {
  CORE,
  GLOW,
  RAYS,
  STAR_GRID,
  STAR_TONES,
  TWINKLE_STILL,
  TWINKLE_STRIP,
  type TwinkleLayer,
} from "./starArt.ts";

export const STAR_SIZE = 48;

/** MX-AL draws the bright star at 56 of the resting 48; MX-AM's dimmed one at 35%. */
const LIGHTS: Readonly<Record<StarLight, { readonly scale: number; readonly opacity: number }>> = {
  rest: { scale: 1, opacity: 1 },
  twinkle: { scale: 1, opacity: 1 },
  bright: { scale: 56 / 48, opacity: 1 },
  dim: { scale: 1, opacity: 0.35 },
};

/** DESIGN.md, Motion: `--ease-out`. */
const EASE_OUT = Easing.bezier(0.215, 0.61, 0.355, 1);

const LIGHT_MS = 320;

/** The bright star's halo spans twice the star. */
const HALO = STAR_SIZE * 2;

const Twinkle = ({ moving }: { readonly moving: boolean }) => {
  const clock = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!moving) return;

    const loop = Animated.loop(
      Animated.timing(clock, {
        toValue: 1,
        duration: DITHER_FRAMES * DITHER_FRAME_MS,
        easing: (t) => t,
        useNativeDriver: true,
      })
    );

    loop.start();

    return () => loop.stop();
  }, [clock, moving]);

  const transform = useMemo(
    () => (moving ? [{ translateX: clock.interpolate(ditherSteps(STAR_SIZE)) }] : []),
    [clock, moving]
  );

  const layers: ReadonlyArray<TwinkleLayer> = moving ? TWINKLE_STRIP : TWINKLE_STILL;
  const frames = moving ? DITHER_FRAMES : 1;

  return (
    <View style={{ position: "absolute", width: STAR_SIZE, height: STAR_SIZE, overflow: "hidden" }}>
      <Animated.View style={{ transform }}>
        <Svg
          width={STAR_SIZE * frames}
          height={STAR_SIZE}
          viewBox={`0 0 ${STAR_GRID * frames} ${STAR_GRID}`}
        >
          {layers.map((layer) => (
            <Path key={layer.alpha} d={layer.d} fill={STAR_TONES.glow} fillOpacity={layer.alpha} />
          ))}
        </Svg>
      </Animated.View>
    </View>
  );
};

const Halo = ({ opacity }: { readonly opacity: Animated.AnimatedInterpolation<number> }) => (
  <Animated.View
    style={{
      position: "absolute",
      left: (STAR_SIZE - HALO) / 2,
      top: (STAR_SIZE - HALO) / 2,
      opacity,
    }}
  >
    <Svg width={HALO} height={HALO}>
      <Defs>
        <RadialGradient id="star-halo" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={STAR_TONES.ray} stopOpacity={0.28} />
          <Stop offset="1" stopColor={STAR_TONES.ray} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width={HALO} height={HALO} fill="url(#star-halo)" />
    </Svg>
  </Animated.View>
);

/** The star, `STAR_SIZE` square and centred across the screen at `top`; it takes no touches. */
export const Star = ({ light, top }: { readonly light: StarLight; readonly top: number }) => {
  const reduced = useReducedMotion();
  const target = LIGHTS[light];
  const scale = useRef(new Animated.Value(target.scale)).current;
  const opacity = useRef(new Animated.Value(target.opacity)).current;

  useEffect(() => {
    if (reduced) {
      scale.setValue(target.scale);
      opacity.setValue(target.opacity);

      return;
    }

    const change = Animated.parallel([
      Animated.timing(scale, {
        toValue: target.scale,
        duration: LIGHT_MS,
        easing: EASE_OUT,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: target.opacity,
        duration: LIGHT_MS,
        easing: EASE_OUT,
        useNativeDriver: true,
      }),
    ]);

    change.start();

    return () => change.stop();
  }, [opacity, reduced, scale, target]);

  const halo = scale.interpolate({ inputRange: [1, LIGHTS.bright.scale], outputRange: [0, 1] });

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: "absolute", top, left: 0, right: 0, alignItems: "center" }}
    >
      <Animated.View
        style={{ width: STAR_SIZE, height: STAR_SIZE, opacity, transform: [{ scale }] }}
      >
        <Halo opacity={halo} />
        {light === "twinkle" ? <Twinkle moving={!reduced} /> : null}
        <Svg width={STAR_SIZE} height={STAR_SIZE} viewBox={`0 0 ${STAR_GRID} ${STAR_GRID}`}>
          {light === "twinkle" ? null : <Path d={GLOW} fill={STAR_TONES.glow} />}
          <Path d={RAYS} fill={STAR_TONES.ray} />
          <Path d={CORE} fill={STAR_TONES.core} />
        </Svg>
      </Animated.View>
    </View>
  );
};
