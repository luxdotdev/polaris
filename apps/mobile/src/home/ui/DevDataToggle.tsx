/** Development chrome over Home: switches its Hosts between the live feeds and worst-case data. */
import { Pressable, Text, View } from "react-native";
import {
  chooseDevHomeData,
  type DevHomeData,
  devHomeDataOn,
  useDevHomeData,
} from "../feed/useHomeHosts.ts";

const CHOICES: ReadonlyArray<readonly [DevHomeData, string]> = [
  ["live", "Live"],
  ["worst", "Worst case"],
  ["empty", "Empty"],
  ["one", "One"],
  ["huge", "Huge"],
  ["paper", "Paper"],
];

export const DevDataToggle = ({ bottom }: { readonly bottom: number }) => {
  const data = useDevHomeData();

  if (!devHomeDataOn()) return null;

  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: 0, right: 0, bottom, alignItems: "center" }}
    >
      <View style={{ flexDirection: "row", padding: 2, borderRadius: 8, backgroundColor: "#888" }}>
        {CHOICES.map(([value, label]) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: value === data }}
            onPress={() => chooseDevHomeData(value)}
            style={{
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 6,
              backgroundColor: value === data ? "#fff" : "transparent",
            }}
          >
            <Text maxFontSizeMultiplier={1} style={{ fontSize: 12, color: "#000" }}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
};
