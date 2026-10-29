/**
 * A development-only instrument sheet with a long scrolling body and a text field, opened by
 * `polaris://dev/sheet`, or on launch by `-polarisDevSheet medium|large` (with `-polarisDevTheme
 * moonlit` and `-polarisDevMotion reduced`), which skips iOS's open-link prompt for screenshots.
 */
import { mobileFont, mobileType } from "@polaris/ui/tokens";
import { Schema } from "effect";
import { useEffect, useState } from "react";
import { Linking, Platform, Settings, StyleSheet, Text, TextInput, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { MotionPreference, ThemeName, useMotionPreference, useTheme } from "../theme";
import { InstrumentSheet } from "./host.tsx";
import { HeroWell, SheetHeader, SheetKicker, StatusFooter, StatusItem, Well } from "./parts.tsx";

const DEMO_LINK = "polaris://dev/sheet";

const Star = ({ color }: { readonly color: string }) => (
  <Svg width={13} height={13} viewBox="0 0 12 12">
    <Path d="M6 0.5 L7.1 4.9 L11.5 6 L7.1 7.1 L6 11.5 L4.9 7.1 L0.5 6 L4.9 4.9 Z" fill={color} />
  </Svg>
);

const ROWS = Array.from({ length: 24 }, (_, i) => ({
  title: `Turn ${i + 1}`,
  detail: `${(i * 7) % 60}s · ${["Read", "Edit", "Bash", "Grep"][i % 4]} · apps/mobile/src`,
}));

const DemoBody = () => {
  const { colours } = useTheme();
  const [reply, setReply] = useState("");

  return (
    <>
      <HeroWell>
        <Text style={[mobileType.heading, { color: colours.textStrong }]}>
          Spike GPUI review screen
        </Text>
        <Text style={[mobileType.footnote, { color: colours.textSubtle }]}>
          Codex · mac-studio · polaris
        </Text>
        <Text style={[mobileType.subhead, styles.ask, { color: colours.needsYouText }]}>
          Wants to run a command
        </Text>
        <View
          style={[styles.command, { backgroundColor: colours.bg, borderColor: colours.hairline }]}
        >
          <Text style={[mobileType.command, { color: colours.textDefault }]}>
            $ cargo build --release
          </Text>
        </View>
      </HeroWell>
      <SheetKicker parts={["Reply", "keyboard"]} />
      <Well>
        <TextInput
          value={reply}
          onChangeText={setReply}
          placeholder="Reply…"
          placeholderTextColor={colours.textFaint}
          style={[mobileType.body, { color: colours.textDefault }]}
        />
      </Well>
      <SheetKicker parts={["Turns", ROWS.length]} />
      {ROWS.map((row) => (
        <Well key={row.title}>
          <Text style={[mobileType.heading, { color: colours.textStrong }]}>{row.title}</Text>
          <Text style={[styles.detail, { color: colours.textSubtle }]}>{row.detail}</Text>
        </Well>
      ))}
    </>
  );
};

const LaunchDetent = Schema.Literals(["medium", "large"]);

const LAUNCH_INDEX: Record<typeof LaunchDetent.Type, number> = { medium: 0, large: 1 };

/** A launch argument parsed by `is`, or null when it is absent or not one of its values. */
const launchArgument = <A,>(key: string, is: (value: unknown) => value is A): A | null => {
  const value: unknown = Platform.OS === "ios" ? Settings.get(key) : undefined;

  return is(value) ? value : null;
};

/** The launch arguments' detent, theme and motion, applied once. */
const useLaunchArguments = (): number | null => {
  const { setTheme } = useTheme();
  const { setMotion } = useMotionPreference();

  const [detent] = useState(() => launchArgument("polarisDevSheet", Schema.is(LaunchDetent)));

  useEffect(() => {
    const theme = launchArgument("polarisDevTheme", Schema.is(ThemeName));
    const motion = launchArgument("polarisDevMotion", Schema.is(MotionPreference));

    if (theme !== null) setTheme(theme);

    if (motion !== null) setMotion(motion);
    // Launch arguments are read once.
  }, []);

  return detent === null ? null : LAUNCH_INDEX[detent];
};

/** Mounted once in development; opens the demo sheet when its link arrives. */
export const SheetDemo = () => {
  const { colours } = useTheme();
  const launchIndex = useLaunchArguments();
  const [open, setOpen] = useState(launchIndex !== null);

  useEffect(() => {
    const follow = (url: string | null | undefined) => {
      if (url?.startsWith(DEMO_LINK) === true) setOpen(true);
    };

    void Linking.getInitialURL().then(follow);
    const sub = Linking.addEventListener("url", ({ url }) => follow(url));

    return () => sub.remove();
  }, []);

  return (
    <InstrumentSheet open={open} onClose={() => setOpen(false)} initialIndex={launchIndex ?? 0}>
      <SheetHeader
        title="Instrument sheet"
        kicker={ROWS.length}
        mark={<Star color={colours.needsYou} />}
        onClose={() => setOpen(false)}
      />
      <DemoBody />
      <StatusFooter note="drag · flick · scroll">
        <StatusItem color={colours.diffAddedText} label="mac-studio" />
        <StatusItem color={colours.needsYou} label="lucas-rpi reconnecting" />
      </StatusFooter>
    </InstrumentSheet>
  );
};

const styles = StyleSheet.create({
  ask: { paddingTop: 8, fontWeight: "500" },
  command: { borderWidth: 1, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12 },
  detail: { fontFamily: mobileFont.mono, fontSize: 12, lineHeight: 16 },
});
