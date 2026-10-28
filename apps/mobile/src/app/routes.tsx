/**
 * The screens each route draws. Thread (S2), Constellation (S4), New agent session (S5) and
 * Link this iPhone (R4) replace their stand-ins here when they land.
 */
import { midnight, mobileType } from "@polaris/ui/tokens";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BackBar } from "./BackBar.tsx";

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
}) => <StandIn title="Agent session" detail={props.sessionId} onBack={props.onBack} />;

export const ConstellationRoute = (props: {
  readonly hostId: string;
  readonly constellationId: string;
  readonly onBack: () => void;
}) => <StandIn title="Constellation" detail={props.constellationId} onBack={props.onBack} />;

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

export const NewSessionSheet = (props: { readonly onClose: () => void }) => {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
      <Text style={styles.title}>New agent session</Text>
      <Pressable accessibilityRole="button" onPress={props.onClose}>
        <Text style={styles.detail}>Close</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: midnight.bg },
  body: { paddingHorizontal: 20, paddingTop: 10, gap: 6 },
  large: { ...mobileType.largeTitle, color: midnight.textStrong },
  title: { ...mobileType.title, color: midnight.textStrong },
  detail: { ...mobileType.footnote, color: midnight.textSubtle },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 20,
    gap: 12,
    backgroundColor: midnight.surfaceRaised,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
});
