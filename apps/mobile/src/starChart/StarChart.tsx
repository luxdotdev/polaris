/** Placeholder for the constellation header's star chart (MX-W, MX-X); P1 builds it. */
import { mobileType } from "@polaris/ui/tokens";
import { Text, View } from "react-native";
import { themedStyles } from "../theme/index.ts";
import type { StarChartProps } from "./types.ts";

export const StarChart = ({ tasks }: StarChartProps) => {
  const styles = useStyles();

  return (
    <View style={styles.panel}>
      <Text style={styles.text}>{tasks.length} tasks</Text>
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  panel: { padding: 12, borderRadius: 12, backgroundColor: colours.panel },
  text: { ...mobileType.label, color: colours.textSubtle },
}));
