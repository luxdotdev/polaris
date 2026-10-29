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
  ["none", "None"],
  ["offline", "Offline"],
];

/** A plain segmented control pinned near the foot: development chrome, never product UI. */
export const DevSegments = <T extends string>({
  choices,
  value,
  onChoose,
  bottom,
}: {
  readonly choices: ReadonlyArray<readonly [T, string]>;
  readonly value: T;
  readonly onChoose: (value: T) => void;
  readonly bottom: number;
}) => (
  <View
    pointerEvents="box-none"
    style={{ position: "absolute", left: 0, right: 0, bottom, alignItems: "center" }}
  >
    <View style={{ flexDirection: "row", padding: 2, borderRadius: 8, backgroundColor: "#888" }}>
      {choices.map(([choice, label]) => (
        <Pressable
          key={choice}
          accessibilityRole="button"
          accessibilityState={{ selected: choice === value }}
          onPress={() => onChoose(choice)}
          style={{
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 6,
            backgroundColor: choice === value ? "#fff" : "transparent",
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

export const DevDataToggle = ({ bottom }: { readonly bottom: number }) => {
  const data = useDevHomeData();

  if (!devHomeDataOn()) return null;

  return (
    <DevSegments choices={CHOICES} value={data} onChoose={chooseDevHomeData} bottom={bottom} />
  );
};
