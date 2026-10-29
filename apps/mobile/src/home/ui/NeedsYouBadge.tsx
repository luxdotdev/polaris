/** The header's needs you badge (Paper MX-C): the star and the count; it opens the inbox. */
import { mobileFont } from "@polaris/ui/tokens";
import { Pressable, Text } from "react-native";
import { useTheme } from "../../theme";
import { NeedsYouStar } from "./glyphs.tsx";
import { badgeCount } from "./rowLook.ts";

export const NeedsYouBadge = ({
  count,
  onPress,
}: {
  readonly count: number;
  readonly onPress: () => void;
}) => {
  const { colours } = useTheme();

  if (count <= 0) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${count} need${count === 1 ? "s" : ""} you`}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 32,
        paddingHorizontal: 12,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: colours.hairline,
        backgroundColor: pressed ? colours.raised : colours.panel,
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      <NeedsYouStar size={12} />
      <Text
        style={{
          fontFamily: mobileFont.sans,
          fontSize: 14,
          lineHeight: 18,
          fontWeight: "600",
          color: colours.needsYouText,
          fontVariant: ["tabular-nums"],
        }}
      >
        {badgeCount(count)}
      </Text>
    </Pressable>
  );
};
