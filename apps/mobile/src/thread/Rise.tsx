/**
 * After a new session's first send (Paper MX-AS): its celestial rises off the horizon into the
 * sky and settles into the header slot, then the horizon fades; Reduce Motion skips the rise.
 */
import type { CelestialBody, HarnessKind } from "@polaris/protocol";
import { useCallback, useEffect, useState } from "react";
import {
  type LayoutRectangle,
  Platform,
  Settings,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  Easing,
  interpolate,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { Celestial } from "../celestial";
import { Horizon } from "../horizon";
import { HORIZON_HEIGHT, RIDGE_TOP } from "../horizon/scene.ts";
import { useReducedMotion } from "../theme/index.ts";

/** The header slot's celestial, in points. */
export const SLOT_SIZE = 24;

/** `-polarisDevSlowRise 10` in a development build slows it tenfold, for screenshots. */
const slowdown = (): number => {
  const value: unknown =
    __DEV__ && Platform.OS === "ios" ? Settings.get("polarisDevSlowRise") : null;

  const factor = Number(value ?? 1);

  return factor > 0 ? factor : 1;
};

const RISE_MS = 1800 * slowdown();

const FADE_MS = 500;

/** The rise starts this big and shrinks into the slot. */
const RISE_SCALE = 1.5;

const EASE_OUT = Easing.bezierFn(0.23, 1, 0.32, 1);

const EASE_IN_OUT = Easing.bezierFn(0.65, 0, 0.35, 1);

/** How far up the sky the rise carries it before it heads for the slot, as MX-AS draws it. */
const SKY_SHARE = 0.4;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Where the celestial leaves the ridge: centred, resting on a horizon whose top is `top`. */
export const ridgePoint = (width: number, top: number): Point => ({
  x: width / 2,
  y: top + RIDGE_TOP - (SLOT_SIZE * RISE_SCALE) / 2,
});

export interface Rise {
  /** The celestial hasn't reached the header yet: its slot stays empty. */
  readonly rising: boolean;
  /** Draw the horizon over the transcript's top; never under Reduce Motion. */
  readonly horizon: boolean;
  readonly landed: boolean;
  readonly onSlot: (slot: LayoutRectangle) => void;
  /** The transcript's frame, whose top the horizon stands on. */
  readonly onTranscript: (frame: LayoutRectangle) => void;
  readonly from: Point | null;
  readonly to: Point | null;
  readonly land: () => void;
}

export const useRise = (rise: boolean): Rise => {
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const [landed, setLanded] = useState(!rise || reduced);
  const [slot, setSlot] = useState<Point | null>(null);
  const [top, setTop] = useState<number | null>(null);
  const land = useCallback(() => setLanded(true), []);

  return {
    rising: !landed,
    horizon: rise && !reduced,
    landed,
    onSlot: (frame) => setSlot({ x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }),
    onTranscript: (frame) => setTop(frame.y),
    from: top === null ? null : ridgePoint(width, top),
    to: slot,
    land,
  };
};

/** The horizon the new session stood on, over the transcript's top, fading once it lands. */
export const RiseHorizon = ({ rise }: { readonly rise: Rise }) =>
  rise.horizon ? <FadingHorizon landed={rise.landed} /> : null;

const FadingHorizon = ({ landed }: { readonly landed: boolean }) => {
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (landed)
      opacity.value = withTiming(0, { duration: FADE_MS, reduceMotion: ReduceMotion.Never });
  }, [landed, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View pointerEvents="none" style={[styles.horizon, style]}>
      <Horizon />
    </Animated.View>
  );
};

/** The rising celestial over the screen, once both ends are measured. */
export const RiseLayer = ({
  rise,
  body,
  harness,
}: {
  readonly rise: Rise;
  readonly body: CelestialBody;
  readonly harness: HarnessKind;
}) =>
  !rise.rising || rise.from === null || rise.to === null ? null : (
    <RisingCelestial
      body={body}
      harness={harness}
      from={rise.from}
      to={rise.to}
      onLanded={rise.land}
    />
  );

/** The rising celestial, over the screen; `to` is the header slot's centre. */
const RisingCelestial = ({
  body,
  harness,
  from,
  to,
  onLanded,
}: {
  readonly body: CelestialBody;
  readonly harness: HarnessKind;
  readonly from: Point;
  readonly to: Point;
  readonly onLanded: () => void;
}) => {
  const progress = useSharedValue(0);
  const dx = from.x - to.x;
  const dy = from.y - to.y;

  useEffect(() => {
    progress.value = withDelay(
      150,
      withTiming(
        1,
        { duration: RISE_MS, easing: Easing.linear, reduceMotion: ReduceMotion.Never },
        (finished) => {
          if (finished === true) scheduleOnRN(onLanded);
        }
      )
    );
  }, [progress, onLanded]);

  const style = useAnimatedStyle(() => {
    const p = progress.value;
    // Off the ridge into the sky, a beat there, then into the slot.
    const rise = EASE_OUT(Math.min(1, p / 0.45));
    const settle = EASE_IN_OUT(Math.max(0, (p - 0.55) / 0.45));

    return {
      opacity: interpolate(p, [0, 0.1], [0, 1], "clamp"),
      transform: [
        { translateX: dx * (1 - settle) },
        { translateY: dy * (1 - SKY_SHARE * rise) * (1 - settle) },
        { scale: interpolate(settle, [0, 1], [RISE_SCALE, 1]) },
      ],
    };
  });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={[styles.body, { left: to.x - SLOT_SIZE / 2, top: to.y - SLOT_SIZE / 2 }, style]}
      >
        <Celestial body={body} harness={harness} size={SLOT_SIZE} working />
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  horizon: { position: "absolute", top: 0, left: 0, right: 0, height: HORIZON_HEIGHT },
  body: { position: "absolute", width: SLOT_SIZE, height: SLOT_SIZE },
});
