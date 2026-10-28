/**
 * Review on iPhone as Paper M5 draws it: the Turn's header with Risk / Files, the Polaris risk
 * summary and its tally, the diff with findings inline, and Send back / Accept. Presentational:
 * `ReviewScreen` feeds it from a Host, the diff bench from a fixture.
 */
import type { RiskFinding, RiskSummary, VerdictReason } from "@polaris/protocol";
import { midnight, mobileType } from "@polaris/ui/tokens";
import { type Ref, useCallback, useMemo, useState } from "react";
import {
  type FlatList,
  Image,
  KeyboardAvoidingView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import polarisMark from "../../assets/review/polaris.png";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActionBar } from "./ActionBar.tsx";
import { summaryCaption } from "./copy.ts";
import { DiffList } from "./DiffList.tsx";
import {
  defaultOpen,
  type DiffFileInput,
  type DiffRow,
  type FileOrder,
  fileLines,
  type LineRow,
  reviewRows,
} from "./diffRows.ts";
import type { FindingActions } from "./FindingCard.tsx";
import { type AcceptState, tally } from "./model.ts";
import { diffPalette } from "./palette.ts";
import { SeverityTally } from "./severity.tsx";

export interface ReviewViewProps {
  readonly turnNumber: number;
  readonly sessionTitle: string;
  readonly harnessName: string;
  readonly files: ReadonlyArray<DiffFileInput> | null;
  /** Why the diff can't show, in the user's words. */
  readonly diffProblem: string | null;
  readonly summary: RiskSummary | null;
  readonly accept: AcceptState;
  readonly colourblind: boolean;
  /** Opens every file at first, as the diff bench does; else only files with a Critical. */
  readonly openAll?: boolean;
  readonly notice: string | null;
  readonly sent: ReadonlySet<string>;
  readonly onBack?: (() => void) | undefined;
  readonly onAccept: () => void;
  readonly onSendBack: (reply: string) => void;
  readonly onAskToFix: (finding: RiskFinding, lines: ReadonlyArray<LineRow>) => void;
  readonly onVerdict: (finding: RiskFinding, reason: VerdictReason | null) => void;
  readonly listRef?: Ref<FlatList<DiffRow>> | undefined;
  readonly onScroll?: ((event: NativeSyntheticEvent<NativeScrollEvent>) => void) | undefined;
}

const Segments = ({ value, onChange }: { value: FileOrder; onChange: (v: FileOrder) => void }) => (
  <View style={styles.segments}>
    {(["risk", "path"] as const).map((order) => (
      <Pressable
        key={order}
        accessibilityRole="tab"
        accessibilityState={{ selected: value === order }}
        style={[styles.segment, value === order && styles.segmentOn]}
        onPress={() => onChange(order)}
      >
        <Text style={[styles.segmentText, value === order && styles.segmentTextOn]}>
          {order === "risk" ? "Risk" : "Files"}
        </Text>
      </Pressable>
    ))}
  </View>
);

/** The Starlight-washed Polaris tile with the pixel north-star (DESIGN.md: the reviewer is Polaris). */
const PolarisTile = () => (
  <View style={styles.tile}>
    <Image source={polarisMark} style={styles.mark} />
  </View>
);

const Header = ({
  props,
  order,
  onOrder,
}: {
  props: ReviewViewProps;
  order: FileOrder;
  onOrder: (o: FileOrder) => void;
}) => {
  const added = props.files?.reduce((n, f) => n + f.added, 0) ?? 0;
  const removed = props.files?.reduce((n, f) => n + f.removed, 0) ?? 0;
  const palette = diffPalette(props.colourblind);
  const count = props.files?.length ?? 0;

  return (
    <View style={styles.header}>
      {props.onBack === undefined ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.back}
          onPress={props.onBack}
        >
          <Text style={styles.backArrow}>‹</Text>
        </Pressable>
      )}
      <View style={styles.titles}>
        <Text style={styles.title}>Turn {props.turnNumber}</Text>
        <View style={styles.subtitle}>
          <Text style={styles.meta} numberOfLines={1}>
            {props.sessionTitle} · {count} {count === 1 ? "file" : "files"}
          </Text>
          <Text style={[styles.meta, { color: palette.addedText }]}>+{added}</Text>
          <Text style={[styles.meta, { color: palette.removedText }]}>−{removed}</Text>
        </View>
      </View>
      <Segments value={order} onChange={onOrder} />
    </View>
  );
};

const Summary = ({ props }: { props: ReviewViewProps }) => {
  const findings = props.summary?.findings ?? [];

  return (
    <View style={styles.summary}>
      <View style={styles.summaryRow}>
        <PolarisTile />
        <View style={styles.titles}>
          <Text style={styles.summaryTitle}>Risk summary</Text>
          <Text style={styles.meta}>
            {summaryCaption(props.summary, props.files?.length ?? 0, Date.now())}
          </Text>
        </View>
      </View>
      <SeverityTally counts={tally(findings)} />
    </View>
  );
};

export const ReviewView = (props: ReviewViewProps) => {
  const insets = useSafeAreaInsets();
  const [order, setOrder] = useState<FileOrder>("risk");
  const findings = useMemo(() => props.summary?.findings ?? [], [props.summary]);
  const files = useMemo(() => props.files ?? [], [props.files]);
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const open = useMemo(() => {
    const initial =
      props.openAll === true
        ? new Set(files.map((f) => f.diff.name))
        : defaultOpen(files, findings);

    return new Set(files.map((f) => f.diff.name).filter((p) => initial.has(p) !== toggled.has(p)));
  }, [files, findings, toggled, props.openAll]);

  const problem = props.diffProblem;

  const rows = useMemo(
    () => reviewRows({ files, problem, findings, open, order }),
    [files, problem, findings, order, open]
  );

  const flip = (set: ReadonlySet<string>, key: string) => {
    const next = new Set(set);

    if (!next.delete(key)) next.add(key);

    return next;
  };

  const onToggleFile = useCallback((path: string) => setToggled((s) => flip(s, path)), []);
  const onToggleFinding = useCallback((id: string) => setExpanded((s) => flip(s, id)), []);
  const { onAskToFix, onVerdict, harnessName, sent } = props;

  const actions = useMemo<FindingActions>(
    () => ({
      harnessName,
      sent,
      askToFix: (finding) => onAskToFix(finding, fileLines(files, finding.path)),
      verdict: onVerdict,
    }),
    [harnessName, sent, onAskToFix, onVerdict, files]
  );

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.screen, { paddingTop: insets.top }]}>
      <Header props={props} order={order} onOrder={setOrder} />
      <Summary props={props} />
      <DiffList
        ref={props.listRef}
        rows={rows}
        palette={diffPalette(props.colourblind)}
        expanded={expanded}
        actions={actions}
        onToggleFile={onToggleFile}
        onToggleFinding={onToggleFinding}
        bottomInset={140}
        onScroll={props.onScroll}
      />
      <ActionBar
        accept={props.accept}
        turnNumber={props.turnNumber}
        bottomInset={insets.bottom}
        notice={props.notice}
        onAccept={props.onAccept}
        onSendBack={props.onSendBack}
      />
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: midnight.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 2,
    paddingBottom: 10,
    paddingLeft: 16,
    paddingRight: 20,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: midnight.surfaceSunken,
    borderWidth: 1,
    borderColor: midnight.hairline,
  },
  backArrow: { ...mobileType.title, fontSize: 24, color: midnight.textDefault },
  titles: { flex: 1, gap: 2, minWidth: 0 },
  title: { ...mobileType.title, color: midnight.textStrong },
  subtitle: { flexDirection: "row", gap: 6 },
  meta: { ...mobileType.footnote, lineHeight: 16, color: midnight.textSubtle, flexShrink: 1 },
  segments: {
    flexDirection: "row",
    alignItems: "center",
    height: 36,
    paddingHorizontal: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: midnight.hairline,
    backgroundColor: midnight.surfaceSunken,
  },
  segment: { height: 28, paddingHorizontal: 10, borderRadius: 999, justifyContent: "center" },
  segmentOn: { backgroundColor: midnight.surfaceRaised },
  segmentText: { ...mobileType.footnote, fontWeight: "500", color: midnight.textSubtle },
  segmentTextOn: { color: midnight.textStrong },
  summary: {
    gap: 12,
    paddingTop: 4,
    paddingBottom: 14,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: midnight.hairline,
  },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  summaryTitle: { ...mobileType.heading, lineHeight: 20, color: midnight.textStrong },
  tile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: `${midnight.starlight}38`,
    backgroundColor: `${midnight.starlight}1f`,
    alignItems: "center",
    justifyContent: "center",
  },
  mark: { width: 16, height: 16 },
});
