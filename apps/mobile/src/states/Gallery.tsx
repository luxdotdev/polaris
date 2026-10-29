/**
 * A development screen of phase 3's shared pieces: the scan sheet and the states pattern. Launch a
 * development build with `-polarisDevStates pair|another|empty|offline|review|thread`
 * (`-polarisDevTheme moonlit`). The scan sheet's link here always fails, so nothing is linked.
 */
import { mobileType } from "@polaris/ui/tokens";
import { Schema } from "effect";
import { useEffect, useState } from "react";
import { Platform, ScrollView, Settings, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Celestial, sessionCelestial } from "../celestial/index.tsx";
import { DevSegments } from "../home/ui/DevDataToggle.tsx";
import { Pairing } from "../link/LinkScreen.tsx";
import { LINK_ANOTHER_COPY, ScanSheet, useLinking } from "../link/ScanSheet.tsx";
import type { LinkOutcome } from "../link/linking.ts";
import { ThemeName, themedStyles, useTheme } from "../theme/index.ts";
import { StatePanel } from "./StatePanel.tsx";
import { BubbleFootnote, ReconnectingLine, useBubbleTreatment } from "./thread.tsx";

const DevStates = Schema.Literals(["pair", "another", "empty", "offline", "review", "thread"]);

type DevStates = typeof DevStates.Type;

const launchArgument = <A,>(key: string, is: (value: unknown) => value is A): A | null => {
  const value: unknown = Platform.OS === "ios" ? Settings.get(key) : undefined;

  return is(value) ? value : null;
};

const LAUNCHED = __DEV__ ? launchArgument("polarisDevStates", Schema.is(DevStates)) : null;

export const statesGalleryOn = (): boolean => LAUNCHED !== null;

const CHOICES: ReadonlyArray<readonly [DevStates, string]> = [
  ["pair", "Pair"],
  ["another", "Another"],
  ["empty", "Empty"],
  ["offline", "Offline"],
  ["review", "Review"],
  ["thread", "Thread"],
];

const refuse = (): Promise<LinkOutcome> =>
  new Promise((resolve) =>
    setTimeout(
      () => resolve({ linked: false, message: "the link expired 4 minutes ago (link-expired)" }),
      1200
    )
  );

const noop = () => undefined;

const PairingRefused = () => <Pairing linking={useLinking({ onLink: refuse })} />;

const Title = ({ text }: { readonly text: string }) => {
  const styles = useStyles();

  return <Text style={styles.title}>{text}</Text>;
};

const Bubble = ({ text, failed }: { readonly text: string; readonly failed: boolean }) => {
  const styles = useStyles();

  const treatment = useBubbleTreatment(
    failed ? { kind: "failed", message: "", onSendAgain: noop } : null
  );

  return (
    <View style={[styles.bubble, treatment.view]}>
      <Text style={[styles.bubbleText, treatment.text]}>{text}</Text>
    </View>
  );
};

const Thread = () => {
  const styles = useStyles();

  return (
    <ScrollView contentContainerStyle={styles.thread}>
      <Bubble text="Show the next try on the Hosts row too." failed={false} />
      <BubbleFootnote state={{ kind: "queued", host: "lucas-rpi" }} />
      <View style={styles.gap} />
      <Bubble text="And on the widget." failed />
      <BubbleFootnote
        state={{
          kind: "failed",
          message:
            "Couldn't send: the daemon on lucas-rpi closed the connection while the turn was on its way. Send again once the host is back.",
          onSendAgain: noop,
        }}
      />
      <View style={styles.gap} />
      <ReconnectingLine host="lucas-rpi" onRetry={noop} />
    </ScrollView>
  );
};

const Offline = () => (
  <StatePanel
    title="Can't reach your hosts"
    failure="the relay closed the socket (1006)"
    reconnecting="Polaris keeps trying"
    celestials={[
      <Celestial key="a" body={sessionCelestial("cratered")} size={24} harness="claude" />,
      <Celestial key="b" body={sessionCelestial("ringed")} size={24} harness="codex" />,
    ]}
    action={{ label: "See hosts", onPress: noop }}
  />
);

const Body = ({ data }: { readonly data: DevStates }) => {
  const styles = useStyles();

  switch (data) {
    case "pair":
      return (
        <>
          <PairingRefused />
        </>
      );
    case "another":
      return (
        <>
          <Title text="Hosts" />
          <ScanSheet open {...LINK_ANOTHER_COPY} onClose={noop} onLink={refuse} />
        </>
      );
    case "empty":
      return (
        <>
          <Title text="Sessions" />
          <StatePanel
            title="No hosts yet"
            line="Link this iPhone from Polaris on your Mac. Its hosts and their agent sessions appear here."
            action={{ label: "Link this iPhone", onPress: noop, primary: true }}
          />
        </>
      );
    case "offline":
      return (
        <>
          <Title text="Sessions" />
          <Offline />
        </>
      );
    case "review":
      return (
        <>
          <Title text="Review" />
          <StatePanel
            title="Nothing to review"
            line="An agent session appears here when its turn ends."
          />
        </>
      );
    case "thread":
      return (
        <View style={styles.fill}>
          <Title text="Thread" />
          <Thread />
        </View>
      );
  }
};

export const StatesGallery = () => {
  const styles = useStyles();
  const { setTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<DevStates>(LAUNCHED ?? "empty");

  useEffect(() => {
    const theme = launchArgument("polarisDevTheme", Schema.is(ThemeName));

    if (theme !== null) setTheme(theme);
    // Launch arguments are read once.
  }, []);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Body key={data} data={data} />
      <DevSegments choices={CHOICES} value={data} onChoose={setData} bottom={insets.bottom + 4} />
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  screen: { flex: 1, backgroundColor: colours.ground },
  fill: { flex: 1 },
  title: {
    ...mobileType.largeTitle,
    color: colours.textStrong,
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  thread: { flexGrow: 1, justifyContent: "flex-end", paddingHorizontal: 12, paddingBottom: 120 },
  gap: { height: 18 },
  bubble: {
    alignSelf: "flex-end",
    maxWidth: 300,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colours.hairline,
    backgroundColor: colours.raised,
  },
  bubbleText: {
    ...mobileType.heading,
    fontWeight: "400",
    lineHeight: 22,
    color: colours.textStrong,
  },
}));
