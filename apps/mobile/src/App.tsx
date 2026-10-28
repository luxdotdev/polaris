/**
 * The Mobile App's shell: the Hosts (one HostConnection each), the navigation stack, the tabs
 * with New, and the screen on top. Midnight throughout.
 */
import { midnight } from "@polaris/ui/tokens";
import { Match } from "effect";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { NavigationProvider, useNavigation } from "./app/navigation.tsx";
import {
  ConstellationRoute,
  LinkRoute,
  NewSessionSheet,
  ReviewRoute,
  ReviewTab,
  ThreadRoute,
} from "./app/routes.tsx";
import { TabBar } from "./app/TabBar.tsx";
import { FollowedHostsProvider } from "./home/feed/useFollowedHosts.ts";
import { HomeScreen } from "./home/HomeScreen.tsx";
import { HostsScreen } from "./hosts/HostsScreen.tsx";
import { runSelfCheck } from "./runtime/selfCheck.ts";
import { HostsProvider } from "./runtime/hosts.tsx";
import { useWidgetLinks } from "./widgets/useWidgetLinks.ts";
import { WidgetSync } from "./widgets/WidgetSync.ts";

const TAB_BAR = 58;

const Tabs = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 20);

  return (
    <View style={styles.fill}>
      {navigation.tab === "sessions" ? (
        <HomeScreen
          tabBarHeight={TAB_BAR + bottom}
          actions={{
            openSession: (hostId, sessionId) =>
              navigation.push({ screen: "thread", hostId, sessionId }),
            openReview: (hostId, sessionId) =>
              navigation.push({ screen: "review", hostId, sessionId, turnId: null }),
            openConstellation: (hostId, constellationId) =>
              navigation.push({ screen: "constellation", hostId, constellationId }),
            openHosts: () => navigation.push({ screen: "hosts" }),
            link: () => navigation.push({ screen: "link" }),
          }}
        />
      ) : (
        <ReviewTab />
      )}
      <TabBar
        active={navigation.tab}
        reviewCount={0}
        bottom={bottom}
        onSelect={(next) =>
          next === "hosts" ? navigation.push({ screen: "hosts" }) : navigation.selectTab(next)
        }
        onNew={() => navigation.openNewSession()}
      />
    </View>
  );
};

const Screen = () => {
  const navigation = useNavigation();

  return Match.value(navigation.top).pipe(
    Match.discriminatorsExhaustive("screen")({
      tabs: () => <Tabs />,
      hosts: () => (
        <HostsScreen onBack={navigation.back} onLink={() => navigation.push({ screen: "link" })} />
      ),
      thread: ({ hostId, sessionId }) => (
        <ThreadRoute hostId={hostId} sessionId={sessionId} onBack={navigation.back} />
      ),
      constellation: ({ hostId, constellationId }) => (
        <ConstellationRoute
          hostId={hostId}
          constellationId={constellationId}
          onBack={navigation.back}
        />
      ),
      review: ({ hostId, sessionId, turnId }) => (
        <ReviewRoute
          hostId={hostId}
          sessionId={sessionId}
          turnId={turnId}
          onBack={navigation.back}
        />
      ),
      link: () => <LinkRoute onDone={navigation.back} />,
    })
  );
};

const Shell = () => {
  const navigation = useNavigation();

  useWidgetLinks(navigation.open);

  return (
    <View style={styles.fill}>
      <Screen />
      {navigation.newSession.open ? <NewSessionSheet onClose={navigation.closeNewSession} /> : null}
    </View>
  );
};

export const App = () => {
  useEffect(() => {
    if (!__DEV__) return;
    void runSelfCheck().then((results) => {
      const failed = results.filter((result) => !result.ok);

      console.log(
        failed.length === 0
          ? `Runtime check: ${results.length} of ${results.length} pass on this engine`
          : `Runtime check failed: ${failed.map((result) => `${result.name} (${result.detail})`).join(", ")}`
      );
    });
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <HostsProvider>
        <FollowedHostsProvider>
          <WidgetSync />
          <NavigationProvider>
            <Shell />
          </NavigationProvider>
        </FollowedHostsProvider>
      </HostsProvider>
    </SafeAreaProvider>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: midnight.bg },
});
