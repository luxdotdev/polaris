/**
 * A development screen of the unfolded Duo's context pane (D6) at half the window, fed worst-case
 * data. Launch a development build with `-polarisDevContext worst|failed|lone` (`-polarisDevTheme`).
 */
import { mobileType } from "@polaris/ui/tokens";
import { Schema } from "effect";
import { useEffect, useMemo, useState } from "react";
import { Platform, Settings, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DevSegments } from "../home/ui/DevDataToggle.tsx";
import type { FindingActions } from "../review/FindingCard.tsx";
import { ThemeName, themedStyles, useTheme } from "../theme/index.ts";
import { contextRows } from "./contextRows.ts";
import { type DevContextData, devContext } from "./contextWorst.testing.ts";
import { ContextView } from "./ContextPane.tsx";

const DevContext = Schema.Literals(["worst", "failed", "lone"]);

const launchArgument = <A,>(key: string, is: (value: unknown) => value is A): A | null => {
  const value: unknown = Platform.OS === "ios" ? Settings.get(key) : undefined;

  return is(value) ? value : null;
};

const LAUNCHED = __DEV__ ? launchArgument("polarisDevContext", Schema.is(DevContext)) : null;

export const contextGalleryOn = (): boolean => LAUNCHED !== null;

const CHOICES: ReadonlyArray<readonly [DevContextData, string]> = [
  ["worst", "Worst case"],
  ["failed", "Failed diff"],
  ["lone", "One file"],
];

const ACTIONS: FindingActions = {
  harnessName: "Claude Code",
  askToFix: () => undefined,
  verdict: () => undefined,
  sent: new Set(),
};

export const ContextGallery = () => {
  const styles = useStyles();
  const { setTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [data, setData] = useState<DevContextData>(LAUNCHED ?? "worst");
  const { context, files, findings } = useMemo(() => devContext(data), [data]);

  const rows = useMemo(
    () => contextRows(files, findings, context.path),
    [files, findings, context]
  );

  useEffect(() => {
    const theme = launchArgument("polarisDevTheme", Schema.is(ThemeName));

    if (theme !== null) setTheme(theme);
    // Launch arguments are read once.
  }, []);

  return (
    <View style={styles.screen}>
      <View style={[styles.first, { width: Math.round(width / 2), paddingTop: insets.top + 20 }]}>
        <Text style={styles.note}>The thread stands here.</Text>
      </View>
      <View style={[styles.second, { paddingRight: insets.right, paddingTop: insets.top }]}>
        <ContextView
          key={data}
          context={context}
          connecting={false}
          files={files}
          rows={rows}
          failure={data === "failed" ? "Couldn't send: lucas-mac-studio is reconnecting." : null}
          actions={ACTIONS}
          onOpenReview={() => undefined}
          onPick={() => undefined}
        />
      </View>
      <DevSegments choices={CHOICES} value={data} onChoose={setData} bottom={insets.bottom + 4} />
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  screen: { flex: 1, flexDirection: "row", backgroundColor: colours.ground },
  first: { paddingHorizontal: 20 },
  second: { flex: 1, backgroundColor: colours.panel },
  note: { ...mobileType.callout, color: colours.textFaint },
}));
