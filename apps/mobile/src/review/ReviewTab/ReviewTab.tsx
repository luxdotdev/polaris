/**
 * The Review tab (Paper MX-K, with MX-M's clean lane): every Host's turns ready to review. The
 * turn most in need of you is the hero, Criticals first, with a pager; the rest wait in wells, and
 * turns with no findings are accepted from the clean lane. Empty, it says why.
 */
import { mobileType } from "@polaris/ui/tokens";
import { Match } from "effect";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSettledHosts } from "../../home/feed/settled.ts";
import { homeHostsOf, useFollowedHosts } from "../../home/feed/useFollowedHosts.ts";
import { useDevHomeData } from "../../home/feed/useHomeHosts.ts";
import type { HomeHost } from "../../home/model/home.ts";
import { HORIZON_INSET } from "../../horizon/index.tsx";
import { useMenuActions } from "../../menus/index.ts";
import { themedStyles } from "../../theme/index.ts";
import { type ReadyEmpty, type ReadyToReview, readyToReview } from "../ready.ts";
import { QueueHeader } from "./Header.tsx";
import { paperQueueHosts, paperQueueTurns } from "./paperQueue.testing.ts";
import { type HeroActions, ReviewHero } from "./Hero.tsx";
import { buildQueue, queueItem, turnKey } from "./queue.ts";
import { useQueueTurns } from "./useQueueTurns.tsx";
import { CleanWell, LaneHead, QueueWell } from "./Wells.tsx";

interface Ready {
  readonly hosts: ReadonlyArray<HomeHost>;
  readonly ready: ReadyToReview;
}

const useReady = (): Ready => {
  const followed = useFollowedHosts();
  const live = useSettledHosts(useMemo(() => homeHostsOf(followed), [followed]));
  const paper = useDevHomeData() === "paper";
  const hosts = paper ? paperQueueHosts : live;

  return { hosts, ready: useMemo(() => readyToReview(hosts), [hosts]) };
};

/** The agent sessions ready to review across the followed Hosts. */
export const useReadyToReview = (): ReadyToReview => useReady().ready;

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
  const styles = useStyles();

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

export interface ReviewTabProps {
  readonly tabBarHeight: number;
  readonly onOpen: (hostId: string, sessionId: string) => void;
  readonly onLink: () => void;
  readonly onHosts: () => void;
}

export const ReviewTab = ({ tabBarHeight, onOpen, onLink, onHosts }: ReviewTabProps) => {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { hosts, ready } = useReady();
  const now = useNow();
  const onMenu = useMenuActions();
  const [workspace, setWorkspace] = useState<string | null>(null);
  const read = useQueueTurns(hosts, ready.rows);
  const paper = useDevHomeData() === "paper";
  const turns = paper ? paperQueueTurns : read.turns;

  const workspaces = useMemo(
    () => [...new Set(ready.rows.map((row) => row.workspaceName).filter((name) => name !== ""))],
    [ready.rows]
  );

  const shown = workspace !== null && workspaces.includes(workspace) ? workspace : null;

  const queue = useMemo(
    () =>
      buildQueue(
        ready.rows
          .filter((row) => shown === null || row.workspaceName === shown)
          .map((row) => queueItem(row, turns.get(turnKey(row)) ?? null))
      ),
    [ready.rows, turns, shown]
  );

  const actions: HeroActions = {
    now,
    withHost: new Set(ready.rows.map((row) => row.hostId)).size > 1,
    open: (item) => onOpen(item.row.hostId, item.row.session.id),
    onMenu,
  };

  const waiting = queue.pages.slice(1);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {paper ? null : read.loaders}
      <QueueHeader
        queue={ready.empty === null ? queue : null}
        hostCount={hosts.length}
        workspaces={workspaces}
        selected={shown}
        onSelect={setWorkspace}
        onHosts={onHosts}
      />
      {ready.empty === null ? (
        <ScrollView
          style={styles.list}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(HORIZON_INSET, tabBarHeight + 16) },
          ]}
        >
          <ReviewHero pages={queue.pages} actions={actions} />
          {waiting.length === 0 ? null : <LaneHead label={`waiting · ${waiting.length}`} />}
          {waiting.map((item) => (
            <QueueWell key={item.row.key} item={item} actions={actions} />
          ))}
          {queue.clean.length === 0 ? null : <LaneHead label={`clean · ${queue.clean.length}`} />}
          {queue.clean.map((item) => (
            <CleanWell key={item.row.key} item={item} actions={actions} />
          ))}
        </ScrollView>
      ) : (
        <Empty empty={ready.empty} onLink={onLink} onHosts={onHosts} />
      )}
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  screen: { flex: 1 },
  list: { flex: 1 },
  content: { paddingHorizontal: 10, gap: 6 },
  empty: {
    borderTopWidth: 1,
    borderTopColor: colours.hairline,
    marginHorizontal: 20,
    marginTop: 12,
    paddingTop: 28,
    gap: 8,
  },
  emptyTitle: { ...mobileType.title, color: colours.textStrong },
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
