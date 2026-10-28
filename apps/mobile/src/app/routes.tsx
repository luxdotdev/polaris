/**
 * The screens each route draws. The thread is S2's, New agent session is S5's sheet, and
 * Link this iPhone is `link/LinkScreen.tsx`.
 */
import { SessionId } from "@polaris/protocol";
import { midnight, mobileType } from "@polaris/ui/tokens";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useDuoThread } from "../duo/DuoShell.tsx";
import { NewSessionSheet as NewAgentSessionSheet } from "../newSession/index.ts";
import { ThreadScreen } from "../thread/index.ts";
import { useNavigation } from "./navigation.tsx";

/** The thread; on an unfolded or half-folded Duo it also takes the Duo's focus and composer. */
export const ThreadRoute = (props: {
  readonly hostId: string;
  readonly sessionId: string;
  readonly onBack: () => void;
}) => (
  <ThreadScreen
    hostId={props.hostId}
    sessionId={SessionId.make(props.sessionId)}
    onBack={props.onBack}
    {...useDuoThread()}
  />
);

export { ConstellationScreen as ConstellationRoute } from "../constellation/index.ts";

/** Review (M5) of a Turn; a null `turnId` reviews the latest one that ended. */
export { ReviewScreen as ReviewRoute } from "../review/index.ts";

export const ReviewTab = () => {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8, paddingHorizontal: 20 }]}>
      <Text style={styles.large} accessibilityRole="header">
        Review
      </Text>
    </View>
  );
};

/** The New agent session sheet; a started session opens its thread. */
export const NewSessionSheet = (props: { readonly onClose: () => void }) => {
  const navigation = useNavigation();
  const { workspaceId } = navigation.newSession;

  return (
    <NewAgentSessionSheet
      onClose={props.onClose}
      {...(workspaceId === null ? {} : { workspaceId })}
      onStarted={(hostId, sessionId) => navigation.push({ screen: "thread", hostId, sessionId })}
    />
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: midnight.bg },
  body: { paddingHorizontal: 20, paddingTop: 10, gap: 6 },
  large: { ...mobileType.largeTitle, color: midnight.textStrong },
  title: { ...mobileType.title, color: midnight.textStrong },
  detail: { ...mobileType.footnote, color: midnight.textSubtle },
});
