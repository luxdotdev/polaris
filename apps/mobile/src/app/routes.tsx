/**
 * The screens each route draws. Link this iPhone (R4) replaces its stand-in here when it lands;
 * the thread is S2's and New agent session is S5's sheet.
 */
import { SessionId } from "@polaris/protocol";
import { midnight, mobileType } from "@polaris/ui/tokens";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NewSessionSheet as NewAgentSessionSheet } from "../newSession/index.ts";
import { ThreadScreen } from "../thread/index.ts";
import { BackBar } from "./BackBar.tsx";
import { useNavigation } from "./navigation.tsx";

const StandIn = ({
  title,
  detail,
  onBack,
}: {
  readonly title: string;
  readonly detail: string;
  readonly onBack: () => void;
}) => {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <BackBar label="Sessions" onBack={onBack} />
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.detail} selectable>
          {detail}
        </Text>
      </View>
    </View>
  );
};

export const ThreadRoute = (props: {
  readonly hostId: string;
  readonly sessionId: string;
  readonly onBack: () => void;
}) => (
  <ThreadScreen
    hostId={props.hostId}
    sessionId={SessionId.make(props.sessionId)}
    onBack={props.onBack}
  />
);

export { ConstellationScreen as ConstellationRoute } from "../constellation/index.ts";

export const LinkRoute = (props: { readonly onDone: () => void }) => (
  <StandIn
    title="Link this iPhone"
    detail="Open Polaris on your Mac, then Settings → Devices."
    onBack={props.onDone}
  />
);

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
