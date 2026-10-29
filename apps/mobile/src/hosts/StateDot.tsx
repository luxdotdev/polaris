/**
 * A Host's Connection State as a dot (DESIGN.md, Mobile chrome redesign · phase 2, Hosts):
 * connected a calm white dot, reconnecting an amber ring, offline a hollow grey dot.
 */
import type { ConnectionState } from "@polaris/protocol";
import { Match } from "effect";
import { View } from "react-native";
import { type MobileColours, themedStyles } from "../theme/index.ts";

/** The state line's colour beside the dot: amber while the Host waits on the network or you. */
export const stateLineColour = (state: ConnectionState, colours: MobileColours): string =>
  Match.value(state).pipe(
    Match.when("connected", () => colours.textSubtle),
    Match.whenOr("reconnecting", "needs-attention", () => colours.needsYouText),
    Match.when("offline", () => colours.textFaint),
    Match.exhaustive
  );

export const StateDot = ({ state }: { readonly state: ConnectionState }) => {
  const styles = useStyles();

  return (
    <View style={styles.slot}>
      {Match.value(state).pipe(
        Match.when("connected", () => <View style={[styles.dot, styles.calm]} />),
        Match.when("reconnecting", () => (
          <View style={styles.ring}>
            <View style={[styles.dot, styles.amber]} />
          </View>
        )),
        Match.when("needs-attention", () => <View style={[styles.dot, styles.amber]} />),
        Match.when("offline", () => <View style={[styles.dot, styles.hollow]} />),
        Match.exhaustive
      )}
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  slot: { width: 18, height: 18, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  calm: { backgroundColor: colours.textDefault },
  amber: { backgroundColor: colours.needsYou },
  // Needs you's hue at 40%, as MX-AD's ring; both themes give it as #rrggbb.
  ring: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: `${colours.needsYou}66`,
    alignItems: "center",
    justifyContent: "center",
  },
  hollow: { borderWidth: 1.5, borderColor: colours.textFaint },
}));
