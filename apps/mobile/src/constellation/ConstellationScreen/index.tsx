/**
 * The constellation view on iPhone (Paper MX-W, MX-X; DESIGN.md Mobile chrome redesign · phase
 * 2): the lead's thread under the star chart panel. A star opens its task sheet (MX-Z); past
 * about 30 tasks "View all tasks" opens the list; the stats chip opens the stats sheet.
 */
import { SessionId } from "@polaris/protocol";
import { mobileType } from "@polaris/ui/tokens";
import { useEffect, useMemo, useState } from "react";
import { Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "../../app/navigation.tsx";
import { shortHostName } from "../../home/model/format.ts";
import type { HostConnection, HostStatus } from "../../runtime/hostConnection.ts";
import { useHost, useHostStatus } from "../../runtime/hosts.tsx";
import { useAfter } from "../../runtime/useAfter.ts";
import { themedStyles } from "../../theme/index.ts";
import { ThreadScreen } from "../../thread/index.ts";
import { elapsed } from "../copy.ts";
import { type ConstellationSource, constellationView } from "../model.ts";
import { useConstellation } from "../useConstellation.ts";
import { useVerdicts } from "../useVerdicts.ts";
import { ChartPanel } from "./ChartPanel.tsx";
import { taskDetail } from "./detail.ts";
import { type OpenSheet, renderClaimSheet, renderStatsSheet } from "./sheets.tsx";
import { starChartOf } from "./stars.ts";
import { TaskSheet } from "./TaskSheet.tsx";
import { TasksSheet } from "./TasksSheet.tsx";

/** Re-render elapsed times while the screen is open; nothing runs on the Host for it. */
const useNow = (everyMs: number) => {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);

    return () => clearInterval(timer);
  }, [everyMs]);

  return now;
};

const awayLine = (status: HostStatus): string | null => {
  if (status.state === "connected") return null;

  if (status.state === "offline") return "The host is offline";

  return status.state === "needs-attention" ? "The host needs attention" : "Reconnecting…";
};

/** The stats chip's reading: how long the constellation has run, stopping once it completes. */
const runTime = (source: ConstellationSource, now: number): string => {
  const c = source.constellation;
  const until = c.state === "completed" || c.state === "archived" ? Date.parse(c.updatedAt) : now;

  return elapsed(Date.parse(c.createdAt), until);
};

const Live = ({
  connection,
  constellationId,
  onBack,
}: {
  readonly connection: HostConnection;
  readonly constellationId: string;
  readonly onBack: (() => void) | undefined;
}) => {
  const status = useHostStatus(connection);
  const feed = useConstellation(connection, constellationId);
  const verdicts = useVerdicts(connection, constellationId);
  const navigation = useNavigation();
  const now = useNow(30_000);
  const [opened, setOpened] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [sheet, setSheet] = useState<OpenSheet>(null);
  // Brief reconnects (the app coming back, a network change) stay quiet.
  const away = useAfter(status.state !== "connected");
  const shown: HostStatus = away ? status : { ...status, state: "connected" };
  const source = feed.kind === "live" ? feed.source : null;

  const view = useMemo(
    () => (source === null ? null : constellationView(source, now, opened)),
    [source, now, opened]
  );

  const chart = useMemo(() => (source === null ? null : starChartOf(source)), [source]);

  if (feed.kind === "failed") return <Waiting text={feed.message} />;

  if (source === null || view === null || chart === null)
    return <Waiting text={awayLine(shown) ?? "Loading the constellation…"} />;

  const close = () => setSheet(null);
  const openTask = (taskId: string) => setSheet({ kind: "task", taskId });
  const selected = sheet?.kind === "task" ? sheet.taskId : null;
  const star = chart.tasks.find((t) => t.id === selected) ?? null;

  const hostName = (hostId: string) =>
    hostId === connection.hostId ? shortHostName(connection.name) : hostId;

  const detail = star === null ? null : taskDetail(source, star, hostName, now);
  const slot = { sheet, onClose: close, source, connection, verdicts, now };

  return (
    <>
      <ThreadScreen
        hostId={connection.hostId}
        sessionId={SessionId.make(view.leadSessionId)}
        onBack={onBack ?? (() => undefined)}
        belowHeader={
          <ChartPanel
            chart={chart}
            stats={runTime(source, now)}
            selectedTaskId={selected}
            onPressTask={openTask}
            onOpenStats={() => setSheet({ kind: "stats" })}
            onViewAll={() => setSheet({ kind: "tasks" })}
          />
        }
      />
      <TasksSheet
        open={sheet?.kind === "tasks"}
        onClose={close}
        view={view}
        verdicts={verdicts}
        hostId={connection.hostId}
        constellationId={constellationId}
        onToggleGroup={(group, next) => setOpened((m) => new Map(m).set(group, next))}
        onPressTask={openTask}
      />
      <TaskSheet
        detail={detail}
        onClose={close}
        onOpenWorker={(session) => {
          close();
          navigation.push({
            screen: "thread",
            hostId: session.hostId,
            sessionId: SessionId.make(session.sessionId),
          });
        }}
        onReviewClaim={(taskId) => setSheet({ kind: "claim", taskId })}
      />
      {renderClaimSheet(slot)}
      {renderStatsSheet(slot)}
    </>
  );
};

const Waiting = ({ text }: { readonly text: string }) => {
  const styles = useStyles();

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <Text style={styles.meta}>{text}</Text>
    </SafeAreaView>
  );
};

export interface ConstellationScreenProps {
  readonly hostId: string;
  readonly constellationId: string;
  readonly onBack?: () => void;
}

export const ConstellationScreen = ({
  hostId,
  constellationId,
  onBack,
}: ConstellationScreenProps) => {
  const connection = useHost(hostId);

  return connection === null ? (
    <Waiting text="This host isn't linked to this iPhone." />
  ) : (
    <Live connection={connection} constellationId={constellationId} onBack={onBack} />
  );
};

const useStyles = themedStyles((colours) => ({
  screen: { flex: 1, backgroundColor: colours.ground },
  meta: { ...mobileType.footnote, padding: 20, color: colours.textSubtle },
}));
