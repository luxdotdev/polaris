/**
 * Home with nothing to list (MX-C's wells on the ground): no Host yet, the first snapshot on its
 * way, none reachable, no agent sessions, or none in a workspace.
 */
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

const useStyles = themedStyles((c) => ({
  empty: {
    marginHorizontal: 10,
    paddingVertical: 20,
    paddingHorizontal: 18,
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.hairline,
    backgroundColor: c.well,
  },
  title: { ...mobileType.title, color: c.textStrong },
  body: { ...mobileType.callout, color: c.textSubtle, maxWidth: 320 },
  action: {
    alignSelf: "flex-start",
    marginTop: 8,
    height: 36,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.hairline,
    backgroundColor: c.raised,
    justifyContent: "center",
  },
  actionLabel: { ...mobileType.label, color: c.textDefault },
  loading: { marginHorizontal: 10, gap: 6 },
  ghost: {
    height: 70,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.hairline,
    backgroundColor: c.well,
  },
}));

/** Quiet wells where rows will land; nothing moves, as only Working loops. */
const Loading = ({ styles }: { readonly styles: ReturnType<typeof useStyles> }) => (
  <View
    style={styles.loading}
    accessible
    accessibilityRole="progressbar"
    accessibilityLabel="Loading agent sessions"
  >
    {[1, 0.6, 0.3].map((opacity) => (
      <View key={opacity} style={[styles.ghost, { opacity }]} />
    ))}
  </View>
);

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
    Match.when("loading", () => null),
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

  if (copy === null) return <Loading styles={styles} />;

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
