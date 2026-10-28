/** The new agent session sheet: iOS's page sheet over home, its content the M6 form. */
import { midnight, mobileType } from "@polaris/ui/tokens";
import { KeyboardAvoidingView, Modal, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNewSessionData } from "./api.ts";
import { NewSessionForm } from "./NewSessionForm.tsx";

export interface NewSessionSheetProps {
  readonly onClose: () => void;
  /** Opens on this Workspace (and its Host) instead of the last used one. */
  readonly workspaceId?: string;
  readonly onStarted?: (hostId: string, sessionId: string) => void;
}

export const NewSessionSheet = ({ onClose, workspaceId, onStarted }: NewSessionSheetProps) => {
  const data = useNewSessionData();
  // A page sheet starts one top inset down the window; the keyboard is measured from the window.
  const { top } = useSafeAreaInsets();

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.fill} behavior="padding" keyboardVerticalOffset={top}>
        {data === null ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Connecting to your hosts…</Text>
          </View>
        ) : (
          <NewSessionForm
            hosts={data.hosts}
            api={data.api}
            onClose={onClose}
            {...(workspaceId === undefined ? {} : { workspaceId })}
            {...(onStarted === undefined ? {} : { onStarted })}
          />
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: midnight.surfaceSunken },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { ...mobileType.callout, color: midnight.textSubtle },
});
