/**
 * Home (Paper H4): every Host's agent sessions ranked needs you, working, recent, with
 * approvals answered in place and the horizon at the foot.
 */
import { midnight, mobileType } from "@polaris/ui/tokens";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HostConnection } from "../runtime/hostConnection.ts";
import { useFollowedHosts } from "./feed/useFollowedHosts.ts";
import { buildHome, type HomeRow, type SessionRow } from "./model/home.ts";
import { type Reply, respond } from "./model/respond.ts";
import { EmptyHome } from "./ui/EmptyHome.tsx";
import { NeedsYouMark, WorkingMark } from "./ui/glyphs.tsx";
import { Header } from "./ui/Header.tsx";
import { HORIZON_HEIGHT, Horizon } from "./ui/Horizon.tsx";
import { useConstellationProgress } from "./ui/constellationProgress.ts";
import { ConstellationListRow, NeedsYouRow, SessionListRow } from "./ui/rows.tsx";

export interface HomeActions {
  readonly openSession: (hostId: string, sessionId: string) => void;
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

const Section = ({
  mark,
  label,
  color,
  count,
  children,
}: {
  readonly mark: ReactNode;
  readonly label: string;
  readonly color: string;
  readonly count: number | null;
  readonly children: ReactNode;
}) => (
  <View style={styles.section}>
    <View style={styles.sectionHead}>
      {mark}
      <Text style={[styles.sectionLabel, { color }]} accessibilityRole="header">
        {label}
      </Text>
      {count === null ? null : <Text style={styles.sectionCount}>{count}</Text>}
    </View>
    {children}
  </View>
);

const ConstellationRowWithProgress = ({
  row,
  now,
  onOpen,
}: {
  readonly row: Extract<HomeRow, { kind: "constellation" }>;
  readonly now: number;
  readonly onOpen: () => void;
}) => (
  <ConstellationListRow
    row={row}
    now={now}
    onOpen={onOpen}
    progress={useConstellationProgress(row.hostId, row.constellation.id)}
  />
);

const ListRow = ({
  row,
  now,
  withHost,
  actions,
}: {
  readonly row: HomeRow;
  readonly now: number;
  readonly withHost: boolean;
  readonly actions: HomeActions;
}) =>
  row.kind === "constellation" ? (
    <ConstellationRowWithProgress
      row={row}
      now={now}
      onOpen={() => actions.openConstellation(row.hostId, row.constellation.id)}
    />
  ) : (
    <SessionListRow
      row={row}
      now={now}
      withHost={withHost}
      onOpen={() => actions.openSession(row.hostId, row.session.id)}
    />
  );

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

  const home = useMemo(
    () =>
      buildHome(
        hosts.map(({ connection, status, followed }) => ({
          hostId: connection.hostId,
          name: status.host?.hostname ?? connection.name,
          connection: status.state,
          followed,
        })),
        workspace
      ),
    [hosts, workspace]
  );

  const reply = replyThrough(
    new Map(hosts.map(({ connection }) => [connection.hostId, connection]))
  );

  const withHost = hosts.length > 1;
  const { needsYou, working, recent } = home.sections;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Header
        home={home}
        selected={workspace}
        onSelect={setWorkspace}
        onHosts={actions.openHosts}
      />
      {home.empty === null ? (
        <ScrollView
          style={styles.list}
          contentContainerStyle={{ paddingBottom: HORIZON_HEIGHT - 40 + tabBarHeight }}
        >
          {needsYou.length > 0 ? (
            <Section
              mark={<NeedsYouMark />}
              label="Needs you"
              color={midnight.needsYouText}
              count={needsYou.length}
            >
              {needsYou.map((row, index) => (
                <NeedsYouRow
                  key={row.key}
                  row={row}
                  position={index}
                  first={index === 0}
                  now={now}
                  onOpen={() => actions.openSession(row.hostId, row.session.id)}
                  onReply={reply(row)}
                />
              ))}
            </Section>
          ) : null}
          {working.length > 0 ? (
            <Section
              mark={<WorkingMark />}
              label="Working"
              color={midnight.starlight}
              count={working.length}
            >
              {working.map((row) => (
                <ListRow key={row.key} row={row} now={now} withHost={withHost} actions={actions} />
              ))}
            </Section>
          ) : null}
          {recent.length > 0 ? (
            <Section mark={null} label="Recent" color={midnight.textSubtle} count={null}>
              {recent.map((row) => (
                <ListRow key={row.key} row={row} now={now} withHost={withHost} actions={actions} />
              ))}
            </Section>
          ) : null}
        </ScrollView>
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
  section: {
    borderTopWidth: 1,
    borderTopColor: midnight.hairline,
    paddingTop: 12,
    paddingBottom: 4,
  },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 6 },
  sectionLabel: { ...mobileType.section },
  sectionCount: { ...mobileType.footnote, lineHeight: 16, color: midnight.textFaint },
});
