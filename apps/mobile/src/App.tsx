/**
 * The scaffold's one screen: a plain list of one Host's agent sessions over the gateway, the
 * development pairing setting, and the runtime self-check. Product screens are S1–S7.
 */
import type { SessionEntry } from "@polaris/sdk";
import { midnight, mobileType } from "@polaris/ui/tokens";
import { Predicate } from "effect";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { type HostFeed, useHostFeed } from "./hosts/useHostFeed.ts";
import { LinkScreen } from "./link/LinkScreen.tsx";
import { LinkedHosts } from "./relay/LinkedHosts.tsx";
import { RelayProvider, useRelay } from "./relay/RelayProvider.tsx";
import { HostsProvider } from "./runtime/hosts.tsx";
import { type CheckResult, runSelfCheck } from "./runtime/selfCheck.ts";
import { loadPairing, savePairing } from "./settings/pairing.ts";

const feedLine = (feed: HostFeed | null): string => {
  if (feed === null) return "No host paired";

  if (feed.kind === "connecting") return "Connecting…";

  if (feed.kind === "failed") return feed.message;

  const { view } = feed;

  return `${view.hostName} · ${view.connected ? "connected" : "reconnecting"} · ${view.sessions.length} sessions`;
};

const selfCheckLine = (results: ReadonlyArray<CheckResult> | null): string => {
  if (results === null) return "Runtime check running…";
  const failed = results.filter((result) => !result.ok);

  return failed.length === 0
    ? `Runtime check: ${results.length} of ${results.length} pass on this engine`
    : `Runtime check failed: ${failed.map((result) => `${result.name} (${result.detail})`).join(", ")}`;
};

const SessionRow = ({ entry }: { readonly entry: SessionEntry }) => (
  <View style={styles.row}>
    <Text style={styles.title} numberOfLines={1}>
      {entry.session.title === "" ? "Untitled" : entry.session.title}
    </Text>
    <Text style={styles.meta}>
      {entry.session.state} · {entry.session.harness}
    </Text>
  </View>
);

const PairingSetting = ({ onSaved }: { readonly onSaved: (pairing: string | null) => void }) => {
  const [text, setText] = useState("");

  const save = () => {
    void savePairing(text).then(() => onSaved(text.trim() === "" ? null : text.trim()));
  };

  return (
    <View style={styles.setting}>
      <Text style={styles.meta}>Pairing string (development only)</Text>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="polaris-pair:v1:…"
        placeholderTextColor={midnight.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />
      <Pressable style={styles.button} onPress={save}>
        <Text style={styles.title}>Save</Text>
      </Pressable>
    </View>
  );
};

const Scaffold = ({ onLink }: { readonly onLink: () => void }) => {
  const [pairing, setPairing] = useState<string | null>(null);
  const [checks, setChecks] = useState<ReadonlyArray<CheckResult> | null>(null);
  const feed = useHostFeed(pairing);

  useEffect(() => {
    // EXPO_PUBLIC_POLARIS_PAIRING is a development shortcut for `dev:daemon`'s pairing.
    const fromEnv: unknown = process.env.EXPO_PUBLIC_POLARIS_PAIRING;
    const devPairing = __DEV__ && Predicate.isString(fromEnv) ? fromEnv : null;

    void loadPairing().then((saved) => setPairing(saved ?? devPairing));

    if (__DEV__) void runSelfCheck().then(setChecks);
  }, []);

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.heading}>Sessions</Text>
      <Text style={styles.meta}>{feedLine(feed)}</Text>
      {__DEV__ ? <Text style={styles.meta}>{selfCheckLine(checks)}</Text> : null}
      {__DEV__ ? <PairingSetting onSaved={setPairing} /> : null}
      <LinkedHosts />
      <Pressable style={styles.button} accessibilityRole="button" onPress={onLink}>
        <Text style={styles.title}>Link this iPhone</Text>
      </Pressable>
      <FlatList
        data={feed?.kind === "live" ? feed.view.sessions : []}
        keyExtractor={(entry) => entry.session.id}
        renderItem={({ item }) => <SessionRow entry={item} />}
      />
    </SafeAreaView>
  );
};

/** First run with no linked Host shows Link this iPhone (M8); S1's shell replaces this. */
const Root = () => {
  const relay = useRelay();
  const [linking, setLinking] = useState(false);
  const firstRun = !__DEV__ && relay.loaded && relay.hosts.length === 0;

  if (linking || firstRun)
    return (
      <LinkScreen
        onLinked={() => setLinking(false)}
        onCancel={firstRun ? undefined : () => setLinking(false)}
      />
    );

  return <Scaffold onLink={() => setLinking(true)} />;
};

export const App = () => (
  <SafeAreaProvider>
    <StatusBar style="light" />
    <HostsProvider>
      <RelayProvider>
        <Root />
      </RelayProvider>
    </HostsProvider>
  </SafeAreaProvider>
);

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: midnight.bg, paddingHorizontal: 16, gap: 8 },
  heading: { ...mobileType.largeTitle, color: midnight.textStrong, marginTop: 8 },
  title: { ...mobileType.heading, color: midnight.textStrong },
  meta: { ...mobileType.footnote, color: midnight.textSubtle },
  row: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: midnight.hairline,
    gap: 2,
  },
  setting: { gap: 6, paddingVertical: 8 },
  input: {
    ...mobileType.command,
    color: midnight.textDefault,
    backgroundColor: midnight.surfaceSunken,
    borderColor: midnight.hairline,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
  },
  button: {
    alignSelf: "flex-start",
    backgroundColor: midnight.surfaceRaised,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
});
