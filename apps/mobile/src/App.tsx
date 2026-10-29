/**
 * The Mobile App's shell: the Hosts (one HostConnection each), the navigation stack, the tabs
 * with New, and the screen on top, in the chosen theme.
 */
import { Match } from "effect";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StyleSheet, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { NavigationProvider, useNavigation } from "./app/navigation.tsx";
import {
  ConstellationRoute,
  NewSessionSheet,
  ReviewRoute,
  ReviewTab,
  ThreadRoute,
} from "./app/routes.tsx";
import { SwipeBack } from "./app/SwipeBack.tsx";
import { TabBar } from "./app/TabBar.tsx";
import { DuoShell } from "./duo/DuoShell.tsx";
import { FollowedHostsProvider } from "./home/feed/useFollowedHosts.ts";
import { HomeScreen } from "./home/HomeScreen.tsx";
import { HostsScreen } from "./hosts/HostsScreen.tsx";
import { LinkScreen } from "./link/LinkScreen.tsx";
import { usePush, usePushLinks } from "./push/usePush.ts";
import { RelayProvider, useRelay } from "./relay/RelayProvider.tsx";
import { runSelfCheck } from "./runtime/selfCheck.ts";
import { SheetDemo, SheetHost } from "./sheet/index.tsx";
import { CheckAlive } from "./runtime/CheckAlive.tsx";
import { HostsProvider } from "./runtime/hosts.tsx";
import { useReadyToReview } from "./review/index.ts";
import { useWidgetLinks } from "./widgets/useWidgetLinks.ts";
import { WidgetSync } from "./widgets/WidgetSync.ts";
import { ThemeProvider, themedStyles } from "./theme/index.ts";

const TAB_BAR = 58;

const Tabs = () => {
  const styles = useStyles();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 20);
  const readyCount = useReadyToReview().rows.length;

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
        <ReviewTab
          tabBarHeight={TAB_BAR + bottom}
          onOpen={(hostId, sessionId) =>
            navigation.push({ screen: "review", hostId, sessionId, turnId: null })
          }
          onLink={() => navigation.push({ screen: "link" })}
          onHosts={() => navigation.push({ screen: "hosts" })}
        />
      )}
      <TabBar
        active={navigation.tab}
        reviewCount={readyCount}
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
  const relay = useRelay();
  const [first] = relay.hosts;

  const linkedTo =
    first === undefined
      ? null
      : {
          name: first.hostName,
          onUnlink: () => relay.unlink().then((kept) => kept.map((host) => host.hostName)),
        };

  // A release build has no other route to a Host, so a fresh phone links first.
  if (!__DEV__ && relay.loaded && first === undefined)
    return <LinkScreen onLinked={() => undefined} />;

  const screen = Match.value(navigation.top).pipe(
    Match.discriminatorsExhaustive("screen")({
      tabs: () => <Tabs />,
      hosts: () => (
        <HostsScreen
          onBack={navigation.back}
          onLink={() => navigation.push({ screen: "link" })}
          linkedTo={linkedTo}
        />
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
      link: () => <LinkScreen onLinked={navigation.back} onCancel={navigation.back} />,
    })
  );

  return navigation.top.screen === "tabs" ? (
    screen
  ) : (
    <SwipeBack onBack={navigation.back}>{screen}</SwipeBack>
  );
};

/** Registers for push with each linked Host and answers approval notifications. */
const Push = () => {
  const relay = useRelay();
  usePush(relay.keys?.identity ?? null, relay.hosts, relay.loaded);

  return null;
};

const Shell = () => {
  const styles = useStyles();
  const navigation = useNavigation();

  useWidgetLinks(navigation.open);
  usePushLinks(navigation.open);

  return (
    <SheetHost>
      <View style={styles.fill}>
        <DuoShell>
          <Screen />
        </DuoShell>
        {navigation.newSession.open ? (
          <NewSessionSheet onClose={navigation.closeNewSession} />
        ) : null}
        {__DEV__ ? <SheetDemo /> : null}
      </View>
    </SheetHost>
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
    <ThemeProvider>
      <GestureHandlerRootView style={rootStyles.root}>
        <SafeAreaProvider>
          <StatusBar style="light" />
          <HostsProvider>
            <RelayProvider>
              <FollowedHostsProvider>
                <WidgetSync />
                <CheckAlive />
                <Push />
                <NavigationProvider>
                  <Shell />
                </NavigationProvider>
              </FollowedHostsProvider>
            </RelayProvider>
          </HostsProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ThemeProvider>
  );
};

const useStyles = themedStyles((colours) => ({
  fill: { flex: 1, backgroundColor: colours.ground },
}));

const rootStyles = StyleSheet.create({ root: { flex: 1 } });
