/**
 * The Review tab (Paper H4): every Host's agent sessions ready to review, newest first; a row
 * opens Review of its latest ended Turn. Empty, it says why.
 */
import { midnight, mobileType } from "@polaris/ui/tokens";
import { Match } from "effect";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { homeHostsOf, useFollowedHosts } from "../home/feed/useFollowedHosts.ts";
import { SessionListRow } from "../home/ui/rows.tsx";
import { type ReadyEmpty, type ReadyToReview, readyToReview } from "./ready.ts";

/** The agent sessions ready to review across the followed Hosts. */
export const useReadyToReview = (): ReadyToReview => {
  const hosts = useFollowedHosts();

  return useMemo(() => readyToReview(homeHostsOf(hosts)), [hosts]);
};

/** Re-renders each minute so ages ("42m") stay true. */
const useNow = () => {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);

    return () => clearInterval(timer);
  }, []);

  return now;
};

const Empty = ({
  empty,
  onLink,
  onHosts,
}: {
  readonly empty: ReadyEmpty;
  readonly onLink: () => void;
  readonly onHosts: () => void;
}) => {
  const copy = Match.value(empty).pipe(
    Match.when("no-hosts", () => ({
      title: "No hosts yet",
      body: "Link this iPhone from Polaris on your Mac. Agent sessions ready to review appear here.",
      action: { label: "Link this iPhone", run: onLink },
    })),
    Match.when("unreachable", () => ({
      title: "Can't reach your hosts",
      body: "Agent sessions ready to review appear here as soon as one connects. Polaris keeps trying.",
      action: { label: "See hosts", run: onHosts },
    })),
    Match.when("none", () => ({
      title: "Nothing to review",
      body: "An agent session appears here when its turn ends.",
      action: null,
    })),
    Match.exhaustive
  );

  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{copy.title}</Text>
      <Text style={styles.body}>{copy.body}</Text>
      {copy.action === null ? null : (
        <Pressable accessibilityRole="button" onPress={copy.action.run} style={styles.action}>
          <Text style={styles.actionLabel}>{copy.action.label}</Text>
        </Pressable>
      )}
    </View>
  );
};

export const ReviewTab = ({
  tabBarHeight,
  onOpen,
  onLink,
  onHosts,
}: {
  readonly tabBarHeight: number;
  readonly onOpen: (hostId: string, sessionId: string) => void;
  readonly onLink: () => void;
  readonly onHosts: () => void;
}) => {
  const insets = useSafeAreaInsets();
  const ready = useReadyToReview();
  const now = useNow();
  const withHost = new Set(ready.rows.map((row) => row.hostId)).size > 1;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <Text style={styles.large} accessibilityRole="header">
        Review
      </Text>
      {ready.empty === null ? (
        <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: tabBarHeight }}>
          {ready.rows.map((row) => (
            <SessionListRow
              key={row.key}
              row={row}
              now={now}
              withHost={withHost}
              onOpen={() => onOpen(row.hostId, row.session.id)}
            />
          ))}
        </ScrollView>
      ) : (
        <Empty empty={ready.empty} onLink={onLink} onHosts={onHosts} />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: midnight.bg },
  large: { ...mobileType.largeTitle, color: midnight.textStrong, paddingHorizontal: 20 },
  list: { flex: 1, paddingHorizontal: 20, paddingTop: 12 },
  empty: {
    borderTopWidth: 1,
    borderTopColor: midnight.hairline,
    marginHorizontal: 20,
    marginTop: 12,
    paddingTop: 28,
    gap: 8,
  },
  emptyTitle: { ...mobileType.title, color: midnight.textStrong },
  body: { ...mobileType.callout, color: midnight.textSubtle, maxWidth: 320 },
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
  actionLabel: { ...mobileType.label, color: midnight.textDefault },
});
