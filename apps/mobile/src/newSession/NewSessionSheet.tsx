/** The new agent session sheet: iOS's page sheet over home, its content the M6 form. */
import { midnight } from "@polaris/ui/tokens";
import { KeyboardAvoidingView, Modal, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NewSessionForm } from "./NewSessionForm.tsx";
import { useSheetData } from "./useSheetData.ts";

export interface NewSessionSheetProps {
  readonly onClose: () => void;
  /** Opens on this Workspace (and its Host) instead of the last used one. */
  readonly workspaceId?: string;
  readonly onStarted?: (hostId: string, sessionId: string) => void;
}

export const NewSessionSheet = ({ onClose, workspaceId, onStarted }: NewSessionSheetProps) => {
  const { hosts, api } = useSheetData();
  // A page sheet starts one top inset down the window; the keyboard is measured from the window.
  const { top } = useSafeAreaInsets();

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.fill} behavior="padding" keyboardVerticalOffset={top}>
        <NewSessionForm
          hosts={hosts}
          api={api}
          onClose={onClose}
          {...(workspaceId === undefined ? {} : { workspaceId })}
          {...(onStarted === undefined ? {} : { onStarted })}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: midnight.surfaceSunken },
});
