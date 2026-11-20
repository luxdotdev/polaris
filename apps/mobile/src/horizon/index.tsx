/**
 * The horizon (DESIGN.md, Mobile chrome redesign): the theme's foot scene, the Desktop App's window
 * foot, at a top-level screen's foot, one image pixel to a device pixel, fading in over its top so
 * the content scrolling behind fades out. Static: no timers, no time-of-day lighting.
 */
import type { ReactNode } from "react";
import {
  Dimensions,
  Image,
  type ImageSourcePropType,
  PixelRatio,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, Image as SvgImage, LinearGradient, Mask, Rect, Stop } from "react-native-svg";
import midnightFoot from "../../../../design/assets/scenes/scene-midnight-foot.png";
import nightFoot from "../../../../design/assets/scenes/scene-night-foot.png";
import { type ThemeName, useTheme } from "../theme";
import { footFrame, footLayout, HORIZON_HEIGHT, previewTop } from "./scene.ts";

export { HORIZON_HEIGHT } from "./scene.ts";

/** Moonlit draws the Desktop App's night scene, Midnight its midnight scene (no dawn: no light theme). */
export const FOOT_SCENES: Readonly<Record<ThemeName, ImageSourcePropType>> = {
  midnight: midnightFoot,
  moonlit: nightFoot,
};

const deviceLayout = footLayout(Dimensions.get("window").width, PixelRatio.get());

/** Where the highest hill's top falls in the horizon's box on this iPhone. */
export const RIDGE_TOP = deviceLayout.ridgeTop;

/** How far above the foot the scene starts to show: a list that ends here never runs under it. */
export const HORIZON_CLEAR = Math.ceil(HORIZON_HEIGHT - deviceLayout.fadeTop);

const EDGE_FADE = 32;

/** A fade at the foot of a list that ends above the horizon, so its last row dissolves. */
export const EdgeFade = () => {
  const { colours } = useTheme();

  return (
    <View pointerEvents="none" style={styles.edge}>
      <Svg width="100%" height={EDGE_FADE}>
        <Defs>
          <LinearGradient id="edge-fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colours.ground} stopOpacity={0} />
            <Stop offset="1" stopColor={colours.ground} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height={EDGE_FADE} fill="url(#edge-fade)" />
      </Svg>
    </View>
  );
};

/** Scroll content's bottom padding: MX-C rests the last row 140pt up, clear of the tab pill and hills. */
export const HORIZON_INSET = 140;

/** The scene alone, absolutely placed at its parent's foot; it takes no touches. */
export const Horizon = () => {
  const { width } = useWindowDimensions();
  const { name } = useTheme();
  const foot = footLayout(width, PixelRatio.get());

  return (
    <View pointerEvents="none" style={[styles.horizon, { width }]}>
      <Svg width={width} height={HORIZON_HEIGHT}>
        <Defs>
          <LinearGradient
            id="hz-fade"
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1={foot.fadeTop}
            x2="0"
            y2={foot.fadeBottom}
          >
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={1} />
          </LinearGradient>
          <Mask
            id="hz-mask"
            maskUnits="userSpaceOnUse"
            x={0}
            y={0}
            width={width}
            height={HORIZON_HEIGHT}
          >
            <Rect width={width} height={HORIZON_HEIGHT} fill="url(#hz-fade)" />
          </Mask>
        </Defs>
        <SvgImage
          href={FOOT_SCENES[name]}
          x={foot.left}
          y={foot.top}
          width={foot.width}
          height={foot.height}
          preserveAspectRatio="none"
          mask="url(#hz-mask)"
        />
      </Svg>
    </View>
  );
};

export interface FootSceneProps {
  readonly theme: ThemeName;
  /** The parent's size, in points. */
  readonly width: number;
  readonly height: number;
  /** How far down the parent the highest hill stands. */
  readonly sky: number;
}

/**
 * A theme's foot scene filling its parent, centred, one image pixel to a device pixel; its colours
 * are that theme's whichever theme is active.
 */
export const FootScene = ({ theme, width, height, sky }: FootSceneProps) => {
  const ratio = PixelRatio.get();
  const frame = footFrame(width, ratio);
  const top = previewTop(frame, ratio, height, sky);

  return (
    <Image
      source={FOOT_SCENES[theme]}
      resizeMode="stretch"
      style={[styles.scene, { left: frame.left, top, width: frame.width, height: frame.height }]}
    />
  );
};

/**
 * A top-level screen on the ground with the horizon over its foot; pad scroll content by
 * HORIZON_INSET. `foot={false}` leaves it out, for a state that raises the horizon (MX-AV).
 */
export const HorizonScreen = ({
  children,
  foot = true,
}: {
  readonly children: ReactNode;
  readonly foot?: boolean;
}) => {
  const { colours } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.screen, { backgroundColor: colours.ground }]}>
      {/* The scene bleeds under a side cutout (the Duo's cover display); the screen keeps clear. */}
      <View style={[styles.screen, { paddingLeft: insets.left, paddingRight: insets.right }]}>
        {children}
      </View>
      {foot ? <Horizon /> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  edge: { position: "absolute", left: 0, right: 0, bottom: 0, height: EDGE_FADE },
  horizon: { position: "absolute", left: 0, bottom: 0, height: HORIZON_HEIGHT, overflow: "hidden" },
  scene: { position: "absolute" },
});
