/** A theme card in Appearance (Paper MX-G): its dark's sky, a check when chosen, name and caption. */
import { mobileType } from "@polaris/ui/tokens";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { type ThemeName, useTheme } from "../theme";
import { MOON, MOON_HALO, RIDGE_PATHS, SKIES } from "./sky.ts";
import { ACCESSIBILITY_SCALE, CONTENT_TEXT_SCALE } from "../theme/textScale.ts";

const SkyArt = ({ name }: { readonly name: ThemeName }) => {
  const sky = SKIES[name];

  return (
    <>
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 166 104"
        preserveAspectRatio="xMidYMax slice"
        style={StyleSheet.absoluteFill}
      >
        <Defs>
          <LinearGradient id={`glow-${name}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.4" stopColor="#465CBE" stopOpacity={0} />
            <Stop offset="1" stopColor="#465CBE" stopOpacity={0.18} />
          </LinearGradient>
        </Defs>
        <Rect width="166" height="104" fill={`url(#glow-${name})`} />
        {sky.stars.map(([x, y, size, fill]) => (
          <Rect key={`${x}-${y}`} x={x} y={y} width={size} height={size} fill={fill} />
        ))}
        <Path d={RIDGE_PATHS[0]} fill={sky.ridges[0]} />
        <Path d={RIDGE_PATHS[1]} fill={sky.ridges[1]} />
      </Svg>
      {sky.moon ? (
        <Svg width={72} height={72} viewBox="0 0 72 72" style={styles.moon}>
          <Path d={MOON_HALO} fill="#D9DEE833" />
          {MOON.map(([fill, d]) => (
            <Path key={fill} d={d} fill={fill} />
          ))}
        </Svg>
      ) : null}
    </>
  );
};

export const ThemeCard = ({
  name,
  title,
  caption,
}: {
  readonly name: ThemeName;
  readonly title: string;
  readonly caption: string;
}) => {
  const theme = useTheme();
  const { colours } = theme;
  const chosen = theme.name === name;
  const wraps = useWindowDimensions().fontScale >= ACCESSIBILITY_SCALE;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: chosen }}
      accessibilityLabel={`${title}, ${caption}`}
      onPress={() => theme.setTheme(name)}
      style={styles.card}
    >
      <View
        style={[
          styles.sky,
          { backgroundColor: SKIES[name].ground },
          chosen
            ? { borderColor: colours.textStrong, borderWidth: 1.5 }
            : { borderColor: colours.hairline },
        ]}
      >
        <SkyArt name={name} />
        {chosen ? (
          <View style={[styles.check, { backgroundColor: colours.textStrong }]}>
            <Svg width={12} height={12} viewBox="0 0 12 12">
              <Path
                d="M2.5 6.2l2.3 2.3L9.5 3.8"
                fill="none"
                stroke={colours.panel}
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </View>
        ) : null}
      </View>
      <View style={styles.text}>
        <Text
          style={[styles.title, { color: colours.textStrong }]}
          maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
        >
          {title}
        </Text>
        <Text
          style={[styles.caption, { color: colours.textSubtle }]}
          maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
          numberOfLines={wraps ? 0 : 1}
        >
          {caption}
        </Text>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: { flex: 1, minWidth: 0, gap: 10 },
  sky: { height: 104, borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  moon: { position: "absolute", right: 38, top: 8 },
  check: {
    position: "absolute",
    right: 8,
    top: 8,
    width: 20,
    height: 20,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { gap: 1, paddingHorizontal: 2 },
  title: { ...mobileType.callout, fontWeight: "500", lineHeight: 20 },
  caption: { fontFamily: mobileType.footnote.fontFamily, fontSize: 12, lineHeight: 16 },
});
