/**
 * The constellation on the unfolded Duo (Paper D9): the graph spans both halves left to right,
 * no node on the fold, the claim handed to the user under it, and the lead's conversation as a
 * sheet across the foot. Built from the constellation view's own model and pieces.
 */
import type { Constellation, TaskProjection } from "@polaris/protocol";
import { midnight, mobileType } from "@polaris/ui/tokens";
import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { HandedClaimActions } from "../constellation/claim.tsx";
import { LeadComposer } from "../constellation/composer.tsx";
import { TaskGlyph, segmentColour } from "../constellation/glyphs.tsx";
import { taskBar, taskRow, type TaskRow } from "../constellation/model.ts";
import { useConstellation } from "../constellation/useConstellation.ts";
import { useVerdicts } from "../constellation/useVerdicts.ts";
import { messageLead } from "../constellation/verdict.ts";
import type { HostConnection } from "../runtime/hostConnection.ts";
import { useHost } from "../runtime/hosts.tsx";
import { claimLeft, type Edge, foldOf, graphLayout, NODE_HEIGHT, NODE_WIDTH } from "./graph.ts";
import type { Rect } from "./posture.ts";

const GRAPH_TOP = 126;

const CLAIM_WIDTH = 374;

const rowsOf = (c: Constellation, projections: ReadonlyArray<TaskProjection>, now: number) => {
  const byTask = new Map(projections.map((p) => [p.taskId, p]));
  const parents = new Set(c.tasks.flatMap((t) => (t.parent == null ? [] : [t.parent])));

  return c.tasks.flatMap((task) => {
    if (parents.has(task.id)) return [];
    const row = taskRow(c, task, byTask, now);

    return row === null || row.tone === "ended"
      ? []
      : [{ row, deps: task.deps, group: task.group ?? null }];
  });
};

const Line = ({ edge }: { readonly edge: Edge }) => {
  const dx = edge.x2 - edge.x1;
  const dy = edge.y2 - edge.y1;
  const length = Math.hypot(dx, dy);

  return (
    <View
      pointerEvents="none"
      style={[
        styles.edge,
        {
          left: (edge.x1 + edge.x2) / 2 - length / 2,
          top: (edge.y1 + edge.y2) / 2,
          width: length,
          transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
        },
      ]}
    />
  );
};

const secondOf = (row: TaskRow): string => {
  if (row.second?.kind === "activity") return `${row.second.command} · ${row.second.elapsed}`;

  return row.second?.kind === "after" ? `${row.word} · after ${row.second.ids}` : row.word;
};

const Node = ({ row, x, y }: { readonly row: TaskRow; readonly x: number; readonly y: number }) => (
  <View
    style={[
      styles.node,
      { left: x, top: y },
      row.tone === "needs-you" ? styles.nodeNeedsYou : null,
      row.tone === "waiting" ? styles.nodeWaiting : null,
    ]}
  >
    <TaskGlyph tone={row.tone} harness={row.harness} gate={row.gate} />
    <Text style={[styles.nodeId, row.tone === "needs-you" && { color: midnight.needsYouText }]}>
      {row.id}
    </Text>
    <View style={styles.nodeText}>
      <Text style={styles.nodeTitle} numberOfLines={1}>
        {row.title}
      </Text>
      {row.tone === "done" ? null : (
        <Text
          style={[styles.nodeSecond, row.tone === "needs-you" && { color: midnight.needsYouText }]}
          numberOfLines={1}
        >
          {secondOf(row)}
        </Text>
      )}
    </View>
  </View>
);

const Header = ({
  name,
  state,
  rows,
  onBack,
}: {
  readonly name: string;
  readonly state: string;
  readonly rows: ReadonlyArray<TaskRow>;
  readonly onBack: (() => void) | undefined;
}) => {
  const bar = taskBar(rows);

  return (
    <View style={styles.header}>
      {onBack === undefined ? null : (
        <Pressable
          style={styles.back}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={styles.backGlyph}>‹</Text>
        </Pressable>
      )}
      <View style={styles.titles}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <View style={styles.barLine}>
          <Text style={styles.meta}>
            {state} · {bar.done} of {bar.total} tasks
          </Text>
          {bar.segments.slice(0, 16).map((tone, i) => (
            <View
              key={i}
              style={[
                styles.segment,
                { backgroundColor: segmentColour(tone, bar.harnesses[i] ?? null) },
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  );
};

const useNow = () => {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);

    return () => clearInterval(timer);
  }, []);

  return now;
};

const Live = ({
  connection,
  constellationId,
  division,
  onBack,
}: {
  readonly connection: HostConnection;
  readonly constellationId: string;
  readonly division: Rect;
  readonly onBack: (() => void) | undefined;
}) => {
  const feed = useConstellation(connection, constellationId);
  const verdicts = useVerdicts(connection, constellationId);
  const now = useNow();
  const source = feed.kind === "live" ? feed.source : null;

  const placed = useMemo(
    () => (source === null ? [] : rowsOf(source.constellation, source.projections, now)),
    [source, now]
  );

  const fold = useMemo(() => foldOf(division), [division]);

  const layout = useMemo(
    () =>
      graphLayout(
        placed.map((p) => ({ id: p.row.id, deps: p.deps, group: p.group })),
        fold,
        GRAPH_TOP
      ),
    [placed, fold]
  );

  if (feed.kind === "failed") return <Text style={styles.note}>{feed.message}</Text>;

  if (source === null) return <Text style={styles.note}>Loading the constellation…</Text>;

  const rows = placed.map((p) => p.row);
  const handed = rows.find((r) => r.handed !== null || verdicts.find(r) !== null) ?? null;
  const delivery = handed === null ? null : verdicts.find(handed);
  const handedAt = layout.nodes.find((n) => n.id === handed?.id);
  const at = new Map(layout.nodes.map((n) => [n.id, n]));

  const left = handedAt === undefined ? 0 : claimLeft(layout, handedAt.x, fold, CLAIM_WIDTH);

  return (
    <KeyboardAvoidingView style={styles.fill} behavior="padding">
      <ScrollView
        style={styles.fill}
        contentContainerStyle={{ minHeight: layout.height + 360 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Deeper columns than the display holds scroll sideways; the header stays put. */}
        <ScrollView
          horizontal
          style={StyleSheet.absoluteFill}
          contentContainerStyle={{
            width: Math.max(layout.width, handed === null ? 0 : left + CLAIM_WIDTH + 20),
          }}
          keyboardShouldPersistTaps="handled"
        >
          {layout.edges.map((edge) => (
            <Line key={`${edge.from}>${edge.to}`} edge={edge} />
          ))}
          {rows.map((row) => {
            const node = at.get(row.id);

            return node === undefined ? null : (
              <Node key={row.id} row={row} x={node.x} y={node.y} />
            );
          })}
          {handed === null ? null : (
            <View style={[styles.claim, { left, top: layout.height + 8 }]}>
              <Text style={styles.claimTitle}>
                <Text style={{ color: midnight.needsYouText }}>{handed.id}</Text> Claim · handed to
                you
              </Text>
              <HandedClaimActions
                claim={handed.handed}
                delivery={delivery}
                onVerdict={verdicts.send(handed)}
                onCancel={() => verdicts.cancel(handed)}
              />
            </View>
          )}
        </ScrollView>
        <Header
          name={source.constellation.name}
          state={source.constellation.state}
          rows={rows}
          onBack={onBack}
        />
      </ScrollView>
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        {feed.kind === "live" && feed.lead?.lastMessage != null ? (
          <Text style={styles.leadLine} numberOfLines={2}>
            <Text style={styles.meta}>Lead · </Text>
            {feed.lead.lastMessage.text}
          </Text>
        ) : null}
        <LeadComposer
          harness={feed.kind === "live" ? (feed.lead?.harness ?? null) : null}
          model={feed.kind === "live" ? (feed.lead?.model ?? null) : null}
          disabled={null}
          onSend={(text) =>
            connection
              .run((client) => messageLead(client, constellationId, text))
              .then(() => undefined)
          }
        />
      </View>
    </KeyboardAvoidingView>
  );
};

export interface ConstellationSpanProps {
  readonly hostId: string;
  readonly constellationId: string;
  readonly division: Rect;
  readonly onBack?: () => void;
}

export const ConstellationSpan = ({
  hostId,
  constellationId,
  division,
  onBack,
}: ConstellationSpanProps) => {
  const connection = useHost(hostId);

  return (
    <View style={styles.screen}>
      {connection === null ? (
        <Text style={styles.note}>This host isn't linked to this iPhone.</Text>
      ) : (
        <Live
          connection={connection}
          constellationId={constellationId}
          division={division}
          onBack={onBack}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: midnight.bg },
  fill: { flex: 1 },
  note: { ...mobileType.footnote, color: midnight.textSubtle, padding: 24 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, padding: 20, maxWidth: 440 },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: midnight.hairline,
  },
  backGlyph: { fontSize: 22, lineHeight: 24, color: midnight.textDefault },
  titles: { flex: 1, gap: 2 },
  name: { ...mobileType.title, fontSize: 19, color: midnight.textStrong },
  barLine: { flexDirection: "row", alignItems: "center", gap: 3 },
  meta: { ...mobileType.footnote, color: midnight.textSubtle, marginRight: 6 },
  segment: { width: 10, height: 4 },
  edge: { position: "absolute", height: 1, backgroundColor: "#ffffff2e" },
  node: {
    position: "absolute",
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: midnight.hairline,
    backgroundColor: midnight.surfaceSunken,
  },
  nodeNeedsYou: { borderColor: midnight.needsYou },
  nodeWaiting: { borderStyle: "dashed", backgroundColor: midnight.bg },
  nodeId: { ...mobileType.index, color: midnight.textSubtle },
  nodeText: { flex: 1, minWidth: 0 },
  nodeTitle: { ...mobileType.subhead, color: midnight.textStrong },
  nodeSecond: { ...mobileType.index, fontSize: 11, lineHeight: 14, color: midnight.textSubtle },
  claim: {
    position: "absolute",
    width: CLAIM_WIDTH,
    gap: 8,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: midnight.hairline,
    backgroundColor: midnight.surfaceSunken,
  },
  claimTitle: { ...mobileType.subhead, color: midnight.textStrong },
  sheet: {
    marginHorizontal: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: midnight.hairline,
    backgroundColor: midnight.surfaceSunken,
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    marginTop: 8,
    backgroundColor: midnight.textFaint,
  },
  leadLine: { ...mobileType.callout, color: midnight.textDefault },
});
