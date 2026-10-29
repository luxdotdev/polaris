/**
 * The agent session thread (Paper M4): header, the transcript as a virtualized
 * list, every Turn in order, older ones paged in on scrolling up, the inline Critical finding, suggested
 * chips and the composer. Data comes from the Host's shared connection.
 */
import type { RiskFinding, SessionId, Workspace, WorkspaceId } from "@polaris/protocol";
import { mobileType } from "@polaris/ui/tokens";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "../app/navigation.tsx";
import { useAttachments } from "../composer/useAttachments.ts";
import { useVoiceInput } from "../composer/useVoiceInput.ts";
import type { HostConnection } from "../runtime/hostConnection.ts";
import { useHost, useLiveHost } from "../runtime/hosts.tsx";
import { themedStyles } from "../theme/index.ts";
import { composerMode } from "./composer.ts";
import { Composer, Suggestions } from "./Composer.tsx";
import { openThread, type ThreadController } from "./controller.ts";
import { hostThreadSource } from "./hostSource.ts";
import { harnessName, subtitle } from "./labels.ts";
import { PendingRequests } from "./PendingRequests.tsx";
import { Diamond, Row, type ThreadFocus } from "./Row.tsx";
import { outgoingRows, threadRows, type ThreadRow } from "./rows.ts";
import { chipAction, openCritical, type Suggestion, suggestions } from "./suggestions.ts";
import { threadKey, threads } from "./threads.ts";
import { useAfter } from "../runtime/useAfter.ts";

export interface ThreadScreenProps {
  readonly hostId: string;
  readonly sessionId: SessionId;
  readonly onBack: () => void;
  /** Opens the session in Review (M5); its Review route otherwise. */
  readonly onOpenReview?: () => void;
  /** The iPhone Duo (D6): tapping a step or the finding focuses it; `focusedKey` marks it. */
  readonly onFocus?: (focus: ThreadFocus) => void;
  readonly focusedKey?: string | null;
  /** The iPhone Duo (D7): a minimum height that keeps the chips and composer below the fold. */
  readonly composerSlot?: "inline" | { readonly minHeight: number };
  /** Takes the place of the session's header: a constellation's status above its lead's thread. */
  readonly header?: ReactNode;
}

interface HeldThread {
  readonly controller: ThreadController | null;
  /** False while the Host reconnects; the controller and its transcript stay. */
  readonly live: boolean;
}

/**
 * The Host and session's thread, opened once the Host is first live and kept
 * through reconnects (`threads.ts`); `live` is false while it reconnects.
 */
const useController = (connection: HostConnection | null, sessionId: SessionId): HeldThread => {
  const live = useLiveHost(connection);
  const [controller, setController] = useState<ThreadController | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;
  const opened = connection !== null && (live !== null || controller !== null);

  useEffect(() => {
    const first = liveRef.current;

    if (!opened || connection === null) return;

    const lease = threads.acquire(
      threadKey(connection.hostId, sessionId),
      first === null ? null : () => openThread(hostThreadSource(connection, first), sessionId)
    );

    if (lease === null) return;
    setController(lease.controller);

    return () => {
      lease.release();
      setController(null);
    };
  }, [opened, connection, sessionId]);

  // A new epoch is a new connection: writes that failed while it was down go again.
  const epoch = live?.epoch ?? null;

  useEffect(() => {
    if (epoch !== null) controller?.reconnected();
  }, [controller, epoch]);

  return { controller, live: live !== null };
};

const noSubscribe = () => () => {};

const useThreadState = (controller: ThreadController | null) =>
  useSyncExternalStore(controller?.subscribe ?? noSubscribe, () => controller?.get() ?? null);

const Header = ({
  title,
  line,
  criticals,
  onBack,
}: {
  readonly title: string;
  readonly line: string;
  readonly criticals: number;
  readonly onBack: () => void;
}) => {
  const styles = useStyles();

  return (
    <View style={styles.header}>
      <Pressable
        style={styles.back}
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Text style={styles.backGlyph}>‹</Text>
      </Pressable>
      <View style={styles.titles}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {line}
        </Text>
      </View>
      {criticals === 0 ? null : (
        <View style={styles.pill}>
          <Diamond />
          <Text style={styles.pillLabel}>{criticals} critical</Text>
        </View>
      )}
    </View>
  );
};

const FindingRow = ({
  finding,
  onPress,
}: {
  readonly finding: RiskFinding;
  readonly onPress?: (() => void) | undefined;
}) => {
  const styles = useStyles();

  return (
    <Pressable style={styles.finding} disabled={onPress === undefined} onPress={onPress}>
      <Diamond />
      <Text style={styles.findingTitle} numberOfLines={2}>
        {finding.title}
      </Text>
      <Text style={styles.findingWhere} numberOfLines={1}>
        {finding.path.slice(finding.path.lastIndexOf("/") + 1)}:{finding.lines.start}
      </Text>
    </Pressable>
  );
};

/** Hosts the Workspace's name once the Host's Snapshot has it. */
const useWorkspace = (controller: ThreadController | null, workspaceId: WorkspaceId | null) => {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);

  useEffect(() => {
    if (controller === null || workspaceId === null) return;
    let gone = false;
    void controller.workspace(workspaceId).then((found) => {
      if (!gone) setWorkspace(found);
    });

    return () => {
      gone = true;
    };
  }, [controller, workspaceId]);

  return workspace;
};

const VIEWABILITY = { itemVisiblePercentThreshold: 50, minimumViewTime: 250 };

const keyOf = (row: ThreadRow) => row.key;

export const ThreadScreen = ({
  hostId,
  sessionId,
  onBack,
  onOpenReview,
  onFocus,
  focusedKey = null,
  composerSlot = "inline",
  header,
}: ThreadScreenProps) => {
  const styles = useStyles();
  const connection = useHost(hostId);
  const navigation = useNavigation();
  const { controller, live } = useController(connection, sessionId);
  const state = useThreadState(controller);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const visible = useRef<ReadonlyArray<string>>([]);
  const fold = state?.fold ?? null;
  const workspaceId = fold?.session.workspaceId ?? null;
  const workspace = useWorkspace(controller, workspaceId);

  const stageTarget = useMemo(
    () =>
      connection === null || workspaceId === null ? null : { connection, workspaceId, sessionId },
    [connection, workspaceId, sessionId]
  );

  const attachments = useAttachments(stageTarget);

  const voice = useVoiceInput({
    connection,
    text: state?.text ?? "",
    onText: (text) => controller?.type(text),
  });

  const steers = state?.steers;
  const queued = state?.queued;

  const rows = useMemo(
    // The list is inverted: the newest row first, at the bottom of the screen.
    () =>
      [...threadRows(fold?.turns ?? [], expanded), ...outgoingRows(steers ?? [], queued)].reverse(),
    [fold?.turns, expanded, steers, queued]
  );

  const editSteer = useCallback((id: string) => controller?.editSteer(id), [controller]);

  const rowsRef = useRef<ReadonlyArray<ThreadRow>>(rows);
  rowsRef.current = rows;

  const findings = state?.findings ?? [];
  const critical = openCritical(findings);

  const criticals = useMemo(
    () => findings.filter((f) => f.severity === "critical" && f.status === "open"),
    [findings]
  );

  const criticalPaths = useMemo(() => new Set(criticals.map((f) => f.path)), [criticals]);

  const toggle = useCallback(
    (key: string) =>
      setExpanded((open) => {
        const next = new Set(open);

        if (!next.delete(key)) next.add(key);

        return next;
      }),
    []
  );

  const report = useCallback(() => {
    if (AppState.currentState === "active") controller?.seen(visible.current);
  }, [controller]);

  const reportRef = useRef(report);
  reportRef.current = report;

  const onViewable = useRef(
    ({
      viewableItems,
    }: {
      readonly viewableItems: ReadonlyArray<{ readonly index?: number | null | undefined }>;
    }) => {
      visible.current = viewableItems.flatMap((token) => {
        const row: ThreadRow | undefined =
          token.index === null || token.index === undefined
            ? undefined
            : rowsRef.current[token.index];

        return row === undefined ? [] : [row.turnId];
      });
      reportRef.current();
    }
  );

  // Brief reconnects (the app coming back, a network change) stay quiet.
  const away = useAfter(!live);
  const slowToOpen = useAfter(state === null || fold === null);

  // A new Turn ending on screen, or coming back to the app, moves the read position.
  useEffect(report, [report, fold?.turns]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", () => reportRef.current());

    return () => listener.remove();
  }, []);

  if (connection === null)
    return <Missing onBack={onBack} header={header} text="This host isn't linked to this iPhone" />;

  if (state === null || fold === null)
    return (
      <Missing
        onBack={onBack}
        header={header}
        text={state?.failure ?? (slowToOpen ? "Connecting…" : "")}
      />
    );

  const { session } = fold;
  const last = fold.turns.at(-1)?.turn ?? null;

  const mode = composerMode({
    state: session.state,
    lastTurn: last?.status ?? null,
    pendingApprovals: fold.pendingApprovals,
    canSteer: controller?.canSteer ?? false,
  });

  const chips = suggestions({
    state: session.state,
    lastTurn: last?.status ?? null,
    findings,
  });

  const pick = (chip: Suggestion) => {
    const action = chipAction(chip, hostId, sessionId);

    if (action.kind === "fill") controller?.type(action.text);
    else if (onOpenReview === undefined) navigation.push(action.route);
    else onOpenReview();
  };

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={styles.screen} behavior="padding">
        {header ?? (
          <Header
            title={session.title === "" ? "Untitled" : session.title}
            line={subtitle([
              harnessName(session.harness),
              connection.name,
              workspace?.name ?? null,
            ])}
            criticals={criticals.length}
            onBack={onBack}
          />
        )}
        <FlatList
          style={[styles.list, away ? styles.offline : null]}
          contentContainerStyle={styles.listContent}
          data={rows}
          inverted
          keyExtractor={keyOf}
          renderItem={({ item }) => (
            <Row
              row={item}
              criticalPaths={criticalPaths}
              onToggle={toggle}
              onFocus={onFocus}
              focused={item.key === focusedKey}
              onEditSteer={editSteer}
              hostId={hostId}
            />
          )}
          ListHeaderComponent={
            <>
              <PendingRequests
                requests={fold.pendingApprovals}
                answering={state.answering}
                errors={state.requestErrors}
                enabled={live}
                onRespond={(requestId, decision) => void controller?.respond(requestId, decision)}
              />
              {critical === null ? null : (
                <FindingRow
                  finding={critical}
                  onPress={
                    onFocus === undefined || last === null
                      ? undefined
                      : () =>
                          onFocus({
                            key: `finding:${critical.id}`,
                            turnId: last.id,
                            kind: "finding",
                            label: critical.title,
                            paths: [critical.path],
                          })
                  }
                />
              )}
            </>
          }
          // Inverted: the end is the top, the oldest Turn; older ones page in from there.
          onEndReached={() => controller?.loadOlder()}
          onEndReachedThreshold={1.5}
          ListFooterComponent={<OlderNote loading={state.older === "loading"} />}
          initialNumToRender={16}
          maxToRenderPerBatch={12}
          windowSize={9}
          removeClippedSubviews
          onViewableItemsChanged={onViewable.current}
          viewabilityConfig={VIEWABILITY}
          keyboardDismissMode="interactive"
        />
        <View
          style={[
            styles.bottom,
            composerSlot === "inline"
              ? null
              : { minHeight: composerSlot.minHeight, justifyContent: "flex-end" },
          ]}
        >
          {away ? <Text style={styles.queued}>Reconnecting to {connection.name}…</Text> : null}
          <Suggestions items={chips} onPick={pick} />
          <Composer
            mode={mode}
            text={state.text}
            harness={session.harness}
            model={session.model}
            workingSince={last?.status === "working" ? last.startedAt : null}
            draftStatus={state.draftStatus}
            error={state.error}
            onChange={(text) => controller?.type(text)}
            attach={attachments.input}
            attaching={attachments.staging}
            voice={voice}
            onSend={() => {
              voice?.release();
              const sent = attachments.submission();
              void controller?.submit(sent.attachments).then((taken) => {
                if (taken) sent.done();
              });
            }}
            onQueue={() => {
              voice?.release();
              const held = attachments.submission();

              if (controller?.queue(held.attachments) === true) held.done();
            }}
            onStop={() => void controller?.interrupt()}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

/** At the top of the thread while older Turns are on their way. */
const OlderNote = ({ loading }: { readonly loading: boolean }) => {
  const styles = useStyles();

  return loading ? <Text style={styles.older}>Loading earlier turns…</Text> : null;
};

const Missing = ({
  text,
  onBack,
  header,
}: {
  readonly text: string;
  readonly onBack: () => void;
  readonly header: ReactNode;
}) => {
  const styles = useStyles();

  return (
    <SafeAreaView style={styles.screen}>
      {header ?? <Header title="" line="" criticals={0} onBack={onBack} />}
      <Text style={styles.missing}>{text}</Text>
    </SafeAreaView>
  );
};

const useStyles = themedStyles((colours) => ({
  screen: { flex: 1, backgroundColor: colours.ground },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 6,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colours.hairline,
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colours.raised,
  },
  backGlyph: { fontSize: 24, lineHeight: 26, color: colours.textDefault },
  titles: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...mobileType.title, color: colours.textStrong },
  subtitle: { ...mobileType.footnote, color: colours.textSubtle },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colours.hairline,
  },
  pillLabel: { ...mobileType.footnote, color: colours.textDefault },
  list: { flex: 1 },
  offline: { opacity: 0.55 },
  listContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  finding: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 40,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: colours.severityCritical,
    marginBottom: 4,
  },
  findingTitle: { ...mobileType.callout, fontWeight: "500", color: colours.textStrong, flex: 1 },
  findingWhere: { ...mobileType.index, color: colours.textFaint },
  bottom: { gap: 10, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8 },
  queued: { ...mobileType.footnote, color: colours.textSubtle, marginHorizontal: 4 },
  older: { ...mobileType.footnote, color: colours.textFaint, textAlign: "center", padding: 12 },
  missing: { ...mobileType.callout, color: colours.textSubtle, padding: 16 },
}));
