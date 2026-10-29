/** Placeholder for the full-screen file diff with its file pager (MX-Q, MX-R); P2 builds it. */
import { mobileType } from "@polaris/ui/tokens";
import { Text, View } from "react-native";
import { themedStyles } from "../theme/index.ts";
import type { FileDiffScreenProps } from "./types.ts";

export const FileDiffScreen = ({ files, index }: FileDiffScreenProps) => {
  const styles = useStyles();

  return (
    <View style={styles.screen}>
      <Text style={styles.text} numberOfLines={1}>
        {files[index]?.diff.name ?? ""}
      </Text>
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  screen: { flex: 1, padding: 16, backgroundColor: colours.ground },
  text: { ...mobileType.label, color: colours.textSubtle },
}));
