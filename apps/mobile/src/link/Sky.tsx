/** M8's night sky: still pixel stars and the Starlight mark above the horizon (Paper M8). */
import { View } from "react-native";
import { themedStyles } from "../theme/index.ts";

/** x, y and opacity of each star, from the artboard. */
const STARS: ReadonlyArray<readonly [number, number, number]> = [
  [38, 70, 0.7],
  [92, 128, 0.45],
  [140, 58, 0.6],
  [250, 84, 0.5],
  [318, 62, 0.75],
  [362, 140, 0.4],
  [60, 196, 0.35],
  [300, 200, 0.35],
  [176, 176, 0.3],
  [226, 40, 0.5],
  [20, 246, 0.25],
  [384, 236, 0.25],
];

/** The Starlight cross: 4-point pixels around a white centre, the outer ones at half. */
const MARK: ReadonlyArray<readonly [number, number, number]> = [
  [4, 0, 1],
  [4, 8, 1],
  [0, 4, 1],
  [8, 4, 1],
  [4, -8, 0.5],
  [4, 16, 0.5],
  [-8, 4, 0.5],
  [16, 4, 0.5],
];

export const Sky = () => {
  const styles = useStyles();

  return (
    <View style={styles.sky} pointerEvents="none" accessibilityElementsHidden>
      {STARS.map(([x, y, opacity]) => (
        <View key={`${x}:${y}`} style={[styles.star, { left: x, top: y, opacity }]} />
      ))}
      <View style={styles.mark}>
        {MARK.map(([x, y, opacity]) => (
          <View key={`${x}:${y}`} style={[styles.markPixel, { left: x, top: y, opacity }]} />
        ))}
        <View style={[styles.markPixel, styles.markCentre]} />
      </View>
      <View style={styles.horizon} />
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  sky: { position: "absolute", top: 0, left: 0, right: 0, height: 280, overflow: "hidden" },
  star: { position: "absolute", width: 2, height: 2, backgroundColor: colours.textDefault },
  mark: { position: "absolute", top: 110, left: "50%", marginLeft: -6, width: 12, height: 12 },
  markPixel: { position: "absolute", width: 4, height: 4, backgroundColor: colours.starlight },
  markCentre: { left: 4, top: 4, backgroundColor: "#ffffff" },
  horizon: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 1,
    backgroundColor: colours.hairline,
  },
}));
