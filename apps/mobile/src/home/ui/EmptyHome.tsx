/** Home with nothing to list: no Host yet, none reachable, no agent sessions, or none in a workspace. */
import { mobileType } from "@polaris/ui/tokens";
import { Match } from "effect";
import { Pressable, Text, View } from "react-native";
import { themedStyles } from "../../theme/index.ts";
import type { HomeEmpty } from "../model/home.ts";

interface Copy {
  readonly title: string;
  readonly body: string;
  readonly action: { readonly label: string; readonly run: () => void } | null;
}

export const EmptyHome = ({
  empty,
  workspace,
  onLink,
  onHosts,
  onAll,
}: {
  readonly empty: HomeEmpty;
  readonly workspace: string | null;
  readonly onLink: () => void;
  readonly onHosts: () => void;
  readonly onAll: () => void;
}) => {
  const styles = useStyles();

  const copy = Match.value(empty).pipe(
    Match.when("no-hosts", (): Copy => ({
      title: "No hosts yet",
      body: "Link this iPhone from Polaris on your Mac. Its hosts and their agent sessions appear here.",
      action: { label: "Link this iPhone", run: onLink },
    })),
    Match.when("unreachable", (): Copy => ({
      title: "Can't reach your hosts",
      body: "Their agent sessions appear here as soon as one connects. Polaris keeps trying.",
      action: { label: "See hosts", run: onHosts },
    })),
    Match.when("no-sessions", (): Copy => ({
      title: "No agent sessions yet",
      body: "Start one with New, or from Polaris on your Mac.",
      action: null,
    })),
    Match.when("filtered", (): Copy => ({
      title: `Nothing in ${workspace ?? "this workspace"}`,
      body: "No agent sessions in this workspace right now.",
      action: { label: "All workspaces", run: onAll },
    })),
    Match.exhaustive
  );

  return (
    <View style={styles.empty}>
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.body}>{copy.body}</Text>
      {copy.action === null ? null : (
        <Pressable accessibilityRole="button" onPress={copy.action.run} style={styles.action}>
          <Text style={styles.actionLabel}>{copy.action.label}</Text>
        </Pressable>
      )}
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  empty: {
    borderTopWidth: 1,
    borderTopColor: colours.hairline,
    marginHorizontal: 20,
    paddingTop: 28,
    gap: 8,
  },
  title: { ...mobileType.title, color: colours.textStrong },
  body: { ...mobileType.callout, color: colours.textSubtle, maxWidth: 320 },
  action: {
    alignSelf: "flex-start",
    marginTop: 8,
    height: 36,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#ffffff1f",
    justifyContent: "center",
  },
  actionLabel: { ...mobileType.label, color: colours.textDefault },
}));
