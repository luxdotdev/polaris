/** Placeholder for the Critical confirmation sheet (MX-T); P3 builds it. */
import { mobileType } from "@polaris/ui/tokens";
import { Text, View } from "react-native";
import { themedStyles } from "../../theme/index.ts";
import type { AcceptReview } from "./useAcceptReview.ts";

export type CriticalConfirmationProps = Pick<AcceptReview, "confirming" | "confirm" | "dismiss">;

export const CriticalConfirmation = ({ confirming }: CriticalConfirmationProps) => {
  const styles = useStyles();

  if (confirming === null) return null;

  return (
    <View style={styles.sheet}>
      <Text style={styles.text}>{confirming.length} critical open</Text>
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  sheet: { padding: 16, backgroundColor: colours.panel },
  text: { ...mobileType.label, color: colours.textDefault },
}));
