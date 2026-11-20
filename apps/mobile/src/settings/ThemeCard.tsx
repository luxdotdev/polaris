/** A theme card in Appearance (Paper MX-G): its foot scene, a check when chosen, name and caption. */
import { mobileType } from "@polaris/ui/tokens";
import { useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { FootScene } from "../horizon/index.tsx";
import { HILLS } from "../horizon/scene.ts";
import { type ThemeName, useTheme } from "../theme";
import { ACCESSIBILITY_SCALE, CONTENT_TEXT_SCALE } from "../theme/textScale.ts";

/** Where the preview's highest hill stands, from its top. */
const PREVIEW_SKY = 34;

/** The theme's foot scene, as the horizon draws it, once the card's size is known. */
const Preview = ({ name }: { readonly name: ThemeName }) => {
  const [size, setSize] = useState<{ readonly width: number; readonly height: number } | null>(
    null
  );

  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={({ nativeEvent: { layout } }) =>
        setSize({ width: layout.width, height: layout.height })
      }
    >
      {size === null ? null : <FootScene theme={name} {...size} sky={PREVIEW_SKY} />}
    </View>
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
          { backgroundColor: HILLS[name].near },
          chosen
            ? { borderColor: colours.textStrong, borderWidth: 1.5 }
            : { borderColor: colours.hairline },
        ]}
      >
        <Preview name={name} />
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
