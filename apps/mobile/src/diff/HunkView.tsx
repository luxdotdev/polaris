/** Placeholder for one hunk drawn inline under a finding (MX-N, MX-Q); P2 builds it. */
import { mobileType } from "@polaris/ui/tokens";
import { Text, View } from "react-native";
import { themedStyles } from "../theme/index.ts";
import type { HunkViewProps } from "./types.ts";

export const HunkView = ({ file, hunk }: HunkViewProps) => {
  const styles = useStyles();

  return (
    <View style={styles.panel}>
      <Text style={styles.text} numberOfLines={1}>
        {file.name} · {hunk.hunkSpecs ?? ""}
      </Text>
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  panel: { padding: 12, backgroundColor: colours.panel },
  text: { ...mobileType.index, color: colours.textSubtle },
}));
