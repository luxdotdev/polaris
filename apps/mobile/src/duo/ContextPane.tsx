/**
 * The unfolded Duo's second half for an agent session (Paper D6): "From turn 24 · Edited
 * serve.ts", the file's diff with its finding inline and "Ask {harness} to fix", then "Also in
 * turn 24". It follows what the first half focuses; it is never a second app.
 */
import {
  type Command,
  harnessEntry,
  type RiskFinding,
  type VerdictReason,
} from "@polaris/protocol";
import { midnight, mobileType } from "@polaris/ui/tokens";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { askToFixCommand, flaggedCode, verdictCommand } from "../review/actions.ts";
import { DiffList } from "../review/DiffList.tsx";
import { fileLines } from "../review/diffRows.ts";
import type { FindingActions } from "../review/FindingCard.tsx";
import { diffPalette } from "../review/palette.ts";
import { SeverityGlyph, severityLabel, severityText } from "../review/severity.tsx";
import { reviewSlot } from "../review/submissions.ts";
import { useReviewSubmissions } from "../review/useSubmissions.ts";
import { useHost, useLiveHost } from "../runtime/hosts.tsx";
import type { ThreadFocus } from "../thread/Row.tsx";
import { contextOf, type OtherFile, type TurnContext } from "./context.ts";
import { contextRows, summaryOf, type TurnFiles } from "./contextRows.ts";
import { useSessionContext, useTurnFiles } from "./useSessionContext.ts";

export interface ContextPaneProps {
  readonly hostId: string;
  readonly sessionId: string;
  readonly focus: ThreadFocus | null;
  readonly onFocus: (focus: ThreadFocus) => void;
  /** The row the second half is showing, so the first half can mark it. */
  readonly onShown: (focusKey: string) => void;
  readonly onOpenReview: (turnId: string) => void;
}

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

const Header = ({
  context,
  onOpenReview,
}: {
  readonly context: TurnContext;
  readonly onOpenReview: () => void;
}) => (
  <View style={styles.header}>
    <View style={styles.star} />
    <Text style={styles.from}>From turn {context.turnNumber} · </Text>
    <Text style={styles.label} numberOfLines={1}>
      {context.label}
    </Text>
    {context.working ? null : (
      <Pressable onPress={onOpenReview} accessibilityRole="link" hitSlop={8}>
        <Text style={styles.open}>Open review</Text>
      </Pressable>
    )}
  </View>
);

const Also = ({
  context,
  files,
  onPick,
}: {
  readonly context: TurnContext;
  readonly files: TurnFiles;
  readonly onPick: (file: OtherFile) => void;
}) => {
  if (context.also.length === 0) return null;
  const counts = files.kind === "ready" ? files.files : [];

  return (
    <View style={styles.also}>
      <Text style={styles.alsoTitle}>Also in turn {context.turnNumber}</Text>
      {context.also.map((file) => {
        const diff = counts.find((f) => f.diff.name === file.path);

        return (
          <Pressable
            key={file.path}
            style={styles.alsoRow}
            onPress={() => onPick(file)}
            accessibilityRole="button"
          >
            <Text style={styles.alsoPath} numberOfLines={1}>
              {basename(file.path)}
            </Text>
            {diff === undefined ? null : (
              <>
                <Text style={styles.added}>+{diff.added}</Text>
                <Text style={styles.removed}>−{diff.removed}</Text>
              </>
            )}
            {file.severity === null ? null : (
              <View style={styles.alsoSeverity}>
                <SeverityGlyph severity={file.severity} size={8} />
                <Text style={[styles.alsoSeverityText, { color: severityText[file.severity] }]}>
                  {severityLabel[file.severity]}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
};

const PALETTE = diffPalette(false);

const NOTHING = new Set<string>();

export const ContextPane = ({
  hostId,
  sessionId,
  focus,
  onFocus,
  onShown,
  onOpenReview,
}: ContextPaneProps) => {
  const connection = useHost(hostId);
  const data = useSessionContext(connection, sessionId);
  const turns = data.fold?.turns ?? [];
  const [opened, setOpened] = useState<ReadonlySet<string>>(NOTHING);
  const submissions = useReviewSubmissions(hostId, useLiveHost(connection));
  const [failure, setFailure] = useState<string | null>(null);

  const turn = useMemo(() => {
    const context0 = contextOf(turns, data.findings, focus);

    return turns.find((e) => e.turn.id === context0?.turnId)?.turn ?? null;
  }, [turns, data.findings, focus]);

  const files = useTurnFiles(data.live, data.fold?.session.cwd ?? null, data.workspacePath, turn);
  const summary = summaryOf(files);
  const findings = summary?.findings ?? data.findings;
  const context = useMemo(() => contextOf(turns, findings, focus), [turns, findings, focus]);
  const path = context?.path ?? null;
  const shownKey = context?.focusKey ?? null;

  useEffect(() => {
    if (shownKey !== null) onShown(shownKey);
  }, [shownKey, onShown]);

  const rows = useMemo(() => contextRows(files, findings, path), [files, findings, path]);

  const harness = data.fold?.session.harness ?? null;

  const { submit, state, version } = submissions;

  const actions = useMemo<FindingActions>(() => {
    const send = (slot: string, payload: string, build: (itemId: string) => Command) => {
      setFailure(null);
      void submit(slot, payload, build).then(setFailure);
    };

    return {
      harnessName: harness === null ? "the agent" : (harnessEntry(harness)?.name ?? harness),
      askToFix: (finding: RiskFinding) => {
        const lines = files.kind === "ready" ? fileLines(files.files, finding.path) : [];
        const code = flaggedCode(finding, lines);

        send(reviewSlot.fix(sessionId, finding.id), code, (commentId) =>
          askToFixCommand(sessionId, finding, code, commentId)
        );
      },
      verdict: (finding: RiskFinding, reason: VerdictReason | null) => {
        if (summary === null) return;
        send(
          reviewSlot.verdict(summary.id, finding.id),
          reason === null ? "up" : `down:${reason}`,
          (verdictId) => verdictCommand(summary.id, finding, reason, verdictId)
        );
      },
      sent: new Set(
        findings
          .filter((f) => state(reviewSlot.fix(sessionId, f.id))?.kind === "sent")
          .map((f) => f.id)
      ),
    };
    // `version` re-reads `state` as submissions move.
  }, [files, findings, harness, sessionId, state, submit, summary, version]);

  const pick = useCallback(
    (file: OtherFile) => {
      if (context === null) return;
      onFocus({
        key: `${context.turnId}:file:${file.path}`,
        turnId: context.turnId,
        kind: "step",
        label: `Edited ${basename(file.path)}`,
        paths: [file.path],
      });
    },
    [context, onFocus]
  );

  if (context === null)
    return (
      <View style={styles.pane}>
        <Text style={styles.empty}>
          {data.fold === null ? "Connecting…" : "Tap a step, file or finding and it shows here."}
        </Text>
      </View>
    );

  return (
    <View style={styles.pane}>
      <Header context={context} onOpenReview={() => onOpenReview(context.turnId)} />
      {failure === null ? null : <Text style={styles.failure}>{failure}</Text>}
      <View style={styles.diff}>
        <DiffList
          rows={rows}
          palette={PALETTE}
          expanded={context.finding === null ? opened : new Set([...opened, context.finding.id])}
          actions={actions}
          onToggleFile={() => undefined}
          onToggleFinding={(id) =>
            setOpened((o) => {
              const next = new Set(o);

              if (!next.delete(id)) next.add(id);

              return next;
            })
          }
          bottomInset={12}
        />
      </View>
      <Also context={context} files={files} onPick={pick} />
    </View>
  );
};

const styles = StyleSheet.create({
  pane: {
    flex: 1,
    backgroundColor: midnight.bg,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: midnight.hairline,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 56,
    paddingHorizontal: 24,
    paddingTop: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: midnight.hairline,
  },
  star: { width: 3, height: 3, backgroundColor: midnight.starlight, marginRight: 6 },
  from: { ...mobileType.footnote, color: midnight.textSubtle },
  label: { ...mobileType.footnote, fontWeight: "500", color: midnight.textStrong, flex: 1 },
  open: { ...mobileType.footnote, color: midnight.textSubtle },
  diff: { flex: 1, paddingHorizontal: 12 },
  empty: { ...mobileType.footnote, color: midnight.textSubtle, padding: 24 },
  failure: { ...mobileType.footnote, color: midnight.failedText, paddingHorizontal: 24 },
  also: { paddingHorizontal: 24, paddingBottom: 16 },
  alsoTitle: { ...mobileType.footnote, color: midnight.textFaint, paddingBottom: 8 },
  alsoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 38,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: midnight.hairline,
  },
  alsoPath: { ...mobileType.command, fontSize: 13, color: midnight.textDefault, flex: 1 },
  added: { ...mobileType.footnote, color: midnight.diffAddedText, fontVariant: ["tabular-nums"] },
  removed: {
    ...mobileType.footnote,
    color: midnight.diffRemovedText,
    fontVariant: ["tabular-nums"],
  },
  alsoSeverity: { flexDirection: "row", alignItems: "center", gap: 5, minWidth: 62 },
  alsoSeverityText: { ...mobileType.footnote },
});
