/**
 * Link this iPhone (Paper M8, MX-AH): the night sky over the scan sheet, which scans the code the
 * Desktop App shows in Settings → Devices, or takes its pasted link, and links once.
 */
import type { LinkedHost } from "@polaris/client/relay";
import { mobileType } from "@polaris/ui/tokens";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRelay } from "../relay/RelayProvider.tsx";
import { themedStyles } from "../theme/index.ts";
import { PAIRING_COPY, ScanSheet } from "./ScanSheet.tsx";
import { Sky } from "./Sky.tsx";

export interface LinkScreenProps {
  readonly onLinked: (hosts: ReadonlyArray<LinkedHost>) => void;
  /** Absent on first run: there is nothing to go back to. */
  readonly onCancel?: (() => void) | undefined;
}

export const LinkScreen = ({ onLinked, onCancel }: LinkScreenProps) => {
  const styles = useStyles();
  const relay = useRelay();

  return (
    <View style={styles.screen}>
      <Sky />
      <SafeAreaView style={styles.content} edges={["top"]}>
        <View style={styles.heading}>
          <Text style={styles.title} accessibilityRole="header">
            Link this iPhone
          </Text>
          <Text style={styles.lead}>
            Your agent sessions run on your Mac. Link it to follow them and answer from here.
          </Text>
        </View>
      </SafeAreaView>
      <ScanSheet
        open
        {...PAIRING_COPY}
        onClose={onCancel}
        onLink={relay.link}
        onLinked={onLinked}
      />
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  screen: { flex: 1, backgroundColor: colours.ground },
  content: { flex: 1 },
  heading: { paddingHorizontal: 36, paddingTop: 56, gap: 10, alignItems: "center" },
  title: { ...mobileType.largeTitle, color: colours.textStrong, textAlign: "center" },
  lead: { ...mobileType.callout, lineHeight: 20, color: colours.textSubtle, textAlign: "center" },
}));
