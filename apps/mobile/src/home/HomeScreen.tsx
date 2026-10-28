/**
 * Home (Paper H4): every Host's agent sessions ranked needs you, working, recent, with
 * approvals answered in place and the horizon at the foot.
 */
import { midnight, mobileType } from "@polaris/ui/tokens";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { SectionList, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  constellationMenu,
  LongPressMenu,
  type MenuAction,
  sessionMenu,
  useMenuActions,
} from "../menus/index.ts";
import type { HostConnection } from "../runtime/hostConnection.ts";
import { homeHostsOf, useFollowedHosts } from "./feed/useFollowedHosts.ts";
import { buildHome, type HomeRow, type SessionRow } from "./model/home.ts";
import { rowDestination } from "./model/lines.ts";
import { type Reply, respond } from "./model/respond.ts";
import {
  constellationsOnScreen,
  type HomeSection,
  homeSections,
  type SectionKind,
  type SeenRow,
} from "./model/sections.ts";
import { EmptyHome } from "./ui/EmptyHome.tsx";
import { NeedsYouMark, WorkingMark } from "./ui/glyphs.tsx";
import { Header } from "./ui/Header.tsx";
import { HORIZON_HEIGHT, Horizon } from "./ui/Horizon.tsx";
import { useConstellationProgress } from "./ui/constellationProgress.ts";
import { ConstellationListRow, NeedsYouRow, SessionListRow } from "./ui/rows.tsx";

export interface HomeActions {
  readonly openSession: (hostId: string, sessionId: string) => void;
  /** Review (M5) of a session's latest ended Turn. */
  readonly openReview: (hostId: string, sessionId: string) => void;
  readonly openConstellation: (hostId: string, constellationId: string) => void;
  readonly openHosts: () => void;
  readonly link: () => void;
}

/** Re-renders each minute so ages ("42m") stay true. */
const useNow = () => {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);

    return () => clearInterval(timer);
  }, []);

  return now;
};

const MARKS: Readonly<Record<SectionKind, ReactNode>> = {
  "needs-you": <NeedsYouMark />,
  working: <WorkingMark />,
  recent: null,
};

const SectionHead = ({ section }: { readonly section: HomeSection }) => (
  <View style={styles.sectionHead}>
    {MARKS[section.kind]}
    <Text
      style={[styles.sectionLabel, section.kind === "needs-you" ? styles.needsYouLabel : null]}
      accessibilityRole="header"
    >
      {section.label}
    </Text>
    {section.count === null ? null : <Text style={styles.sectionCount}>{section.count}</Text>}
  </View>
);

const ConstellationRowWithProgress = ({
  row,
  now,
  onScreen,
  onOpen,
}: {
  readonly row: Extract<HomeRow, { kind: "constellation" }>;
  readonly now: number;
  readonly onScreen: boolean;
  readonly onOpen: () => void;
}) => (
  <ConstellationListRow
    row={row}
    now={now}
    onOpen={onOpen}
    progress={useConstellationProgress(row.hostId, row.constellation.id, onScreen)}
  />
);

const ListRow = ({
  row,
  now,
  withHost,
  onScreen,
  actions,
  onMenu,
}: {
  readonly row: HomeRow;
  readonly now: number;
  readonly withHost: boolean;
  readonly onScreen: boolean;
  readonly actions: HomeActions;
  readonly onMenu: (action: MenuAction) => void;
}) =>
  row.kind === "constellation" ? (
    <LongPressMenu menu={constellationMenu(row)} onAction={onMenu}>
      <ConstellationRowWithProgress
        row={row}
        now={now}
        onScreen={onScreen}
        onOpen={() => actions.openConstellation(row.hostId, row.constellation.id)}
      />
    </LongPressMenu>
  ) : (
    <LongPressMenu menu={sessionMenu(row)} onAction={onMenu}>
      <SessionListRow
        row={row}
        now={now}
        withHost={withHost}
        onOpen={() =>
          rowDestination(row.session) === "review"
            ? actions.openReview(row.hostId, row.session.id)
            : actions.openSession(row.hostId, row.session.id)
        }
      />
    </LongPressMenu>
  );

const VIEWABILITY = { itemVisiblePercentThreshold: 1 } as const;

const replyThrough =
  (connections: ReadonlyMap<string, HostConnection>) =>
  (row: SessionRow) =>
  (reply: Reply): Promise<void> => {
    const connection = connections.get(row.hostId);

    if (connection === undefined || row.approval === null)
      return Promise.reject(new Error("host gone"));
    const approval = row.approval;

    return connection.run((client) => respond(client, approval, reply));
  };

export const HomeScreen = ({
  actions,
  tabBarHeight,
}: {
  readonly actions: HomeActions;
  readonly tabBarHeight: number;
}) => {
  const insets = useSafeAreaInsets();
  const hosts = useFollowedHosts();
  const [workspace, setWorkspace] = useState<string | null>(null);
  const now = useNow();
  const onMenu = useMenuActions();

  const home = useMemo(() => buildHome(homeHostsOf(hosts), workspace), [hosts, workspace]);

  const reply = replyThrough(
    new Map(hosts.map(({ connection }) => [connection.hostId, connection]))
  );

  const withHost = hosts.length > 1;
  const sections = useMemo(() => homeSections(home), [home]);
  const [onScreen, setOnScreen] = useState<ReadonlySet<string>>(() => new Set());

  const onViewable = useCallback(
    ({ viewableItems }: { readonly viewableItems: ReadonlyArray<SeenRow> }) =>
      setOnScreen(constellationsOnScreen(viewableItems)),
    []
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Header
        home={home}
        selected={workspace}
        onSelect={setWorkspace}
        onHosts={actions.openHosts}
      />
      {home.empty === null ? (
        <SectionList<HomeRow, HomeSection>
          style={styles.list}
          contentContainerStyle={{ paddingBottom: HORIZON_HEIGHT - 40 + tabBarHeight }}
          sections={sections}
          keyExtractor={(row) => row.key}
          stickySectionHeadersEnabled={false}
          initialNumToRender={12}
          windowSize={5}
          viewabilityConfig={VIEWABILITY}
          onViewableItemsChanged={onViewable}
          renderSectionHeader={({ section }) => <SectionHead section={section} />}
          renderItem={({ item, index, section }) =>
            section.kind === "needs-you" && item.kind === "session" ? (
              <NeedsYouRow
                row={item}
                position={index}
                first={index === 0}
                now={now}
                onOpen={() => actions.openSession(item.hostId, item.session.id)}
                onReply={reply(item)}
                menu={{ menu: sessionMenu(item), onAction: onMenu }}
              />
            ) : (
              <ListRow
                row={item}
                now={now}
                withHost={withHost}
                onScreen={onScreen.has(item.key)}
                actions={actions}
                onMenu={onMenu}
              />
            )
          }
          renderSectionFooter={() => <View style={styles.sectionFoot} />}
        />
      ) : (
        <EmptyHome
          empty={home.empty}
          workspace={workspace}
          onLink={actions.link}
          onHosts={actions.openHosts}
          onAll={() => setWorkspace(null)}
        />
      )}
      <Horizon hour={new Date(now).getHours()} />
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: midnight.bg },
  list: { flex: 1, paddingHorizontal: 20 },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: midnight.hairline,
    paddingTop: 12,
    paddingBottom: 6,
  },
  sectionFoot: { height: 4 },
  sectionLabel: { ...mobileType.section, color: midnight.textSubtle },
  needsYouLabel: { color: midnight.needsYouText },
  sectionCount: { ...mobileType.footnote, lineHeight: 16, color: midnight.textFaint },
});
