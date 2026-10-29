/** The new agent session sheet: iOS's page sheet over home, its content the M6 form. */
import { KeyboardAvoidingView, Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHosts } from "../runtime/hosts.tsx";
import { themedStyles } from "../theme/index.ts";
import { NewSessionForm } from "./NewSessionForm.tsx";
import { useSheetData } from "./useSheetData.ts";

export interface NewSessionSheetProps {
  readonly onClose: () => void;
  /** Opens on this Workspace (and its Host) instead of the last used one. */
  readonly workspaceId?: string;
  readonly onStarted?: (hostId: string, sessionId: string) => void;
}

export const NewSessionSheet = ({ onClose, workspaceId, onStarted }: NewSessionSheetProps) => {
  const styles = useStyles();
  const { hosts, api } = useSheetData();
  const connections = useHosts();
  // A page sheet starts one top inset down the window; the keyboard is measured from the window.
  const { top } = useSafeAreaInsets();

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.fill} behavior="padding" keyboardVerticalOffset={top}>
        <NewSessionForm
          hosts={hosts}
          api={api}
          onClose={onClose}
          connectionFor={(hostId) => connections.find((c) => c.hostId === hostId) ?? null}
          {...(workspaceId === undefined ? {} : { workspaceId })}
          {...(onStarted === undefined ? {} : { onStarted })}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
};

const useStyles = themedStyles((colours) => ({
  fill: { flex: 1, backgroundColor: colours.panel },
}));
