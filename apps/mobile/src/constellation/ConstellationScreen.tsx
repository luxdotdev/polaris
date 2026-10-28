/**
 * The constellation view on iPhone (Paper C2; DESIGN.md Mobile App, Constellation): the lead
 * with the task bar, tasks as a vertical rail, the claim handed to the user, and a composer
 * addressed to the lead.
 */
import { type HarnessKind, harnessEntry } from "@polaris/protocol";
import { midnight, mobileType } from "@polaris/ui/tokens";
import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { HostConnection, HostStatus } from "../runtime/hostConnection.ts";
import { claimChoices, constellationKey, taskKey, useKept, useLeadInput } from "../duo/kept.ts";
import { useNavigation } from "../app/navigation.tsx";
import { MarkdownLine } from "../markdown/index.ts";
import { useHost, useHostStatus } from "../runtime/hosts.tsx";
import { LeadComposer } from "./composer.tsx";
import { age } from "./copy.ts";
import { harnessHue, segmentColour } from "./glyphs.tsx";
import { type ConstellationView, constellationView } from "./model.ts";
import { GroupHeader, TaskRowView } from "./rows.tsx";
import { type LeadSession, useConstellation } from "./useConstellation.ts";
import { messageLead } from "./verdict.ts";
import { useVerdicts, type Verdicts } from "./useVerdicts.ts";

/** Re-render elapsed times while the screen is open; nothing runs on the Host for it. */
const useNow = (everyMs: number) => {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);

    return () => clearInterval(timer);
  }, [everyMs]);

  return now;
};

const harnessName = (kind: HarnessKind) => harnessEntry(kind)?.name ?? kind;

const leadLine = (view: ConstellationView, lead: LeadSession | null, hostName: string | null) => {
  const doing =
    view.reviewing !== null ? `Reviewing ${view.reviewing}'s claim` : (lead?.state ?? null);

  return [doing, hostName].filter((p) => p !== null && p !== "").join(" · ");
};

const awayLine = (status: HostStatus): string | null => {
  if (status.state === "connected") return null;

  if (status.state === "offline") return "The host is offline";

  return status.state === "needs-attention" ? "The host needs attention" : "Reconnecting…";
};

const Back = ({ onBack }: { readonly onBack: () => void }) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel="Back"
    style={styles.back}
    onPress={onBack}
  >
    <Text style={styles.backArrow}>‹</Text>
  </Pressable>
);

const Mark = () => (
  <View style={styles.mark}>
    <View style={[styles.star, { left: 2, top: 7 }]} />
    <View style={[styles.star, { left: 5, top: 2 }]} />
    <View style={[styles.star, { left: 9, top: 8, opacity: 0.45 }]} />
  </View>
);

/** Past this many tasks the segments share one fixed-width bar instead of overflowing. */
const SEGMENTS_MAX = 8;

const Bar = ({ view }: { readonly view: ConstellationView }) => {
  const packed = view.bar.segments.length > SEGMENTS_MAX;

  return (
    <View style={styles.barBox}>
      <View style={[styles.segments, packed && styles.packed]}>
        {view.bar.segments.map((tone, i) => (
          <View
            key={i}
            style={[
              packed ? styles.slice : styles.segment,
              { backgroundColor: segmentColour(tone, view.bar.harnesses[i] ?? null) },
            ]}
          />
        ))}
      </View>
      <Text style={styles.meta}>
        {view.bar.done} of {view.bar.total} tasks
      </Text>
    </View>
  );
};

const Header = ({
  view,
  lead,
  status,
  hostName,
  onBack,
  onOpenLead,
}: {
  readonly view: ConstellationView;
  readonly lead: LeadSession | null;
  readonly status: HostStatus;
  readonly hostName: string;
  readonly onBack: (() => void) | undefined;
  readonly onOpenLead: () => void;
}) => (
  <View style={styles.header}>
    <View style={styles.titleRow}>
      {onBack === undefined ? null : <Back onBack={onBack} />}
      <View style={styles.titleText}>
        <View style={styles.kicker}>
          <Mark />
          <Text style={styles.meta}>Constellation · {view.state}</Text>
        </View>
        <Text style={styles.name} numberOfLines={2}>
          {view.name}
        </Text>
      </View>
    </View>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open the lead's thread"
      onPress={onOpenLead}
      style={styles.leadRow}
    >
      <View style={[styles.avatar, { borderColor: harnessHue(lead?.harness ?? null) }]}>
        <View style={[styles.avatarDot, { backgroundColor: harnessHue(lead?.harness ?? null) }]} />
      </View>
      <View style={styles.leadText}>
        <Text style={styles.leadTitle} numberOfLines={1}>
          Lead{lead === null ? "" : ` · ${harnessName(lead.harness)}`}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {awayLine(status) ?? leadLine(view, lead, hostName)}
        </Text>
      </View>
      <Bar view={view} />
    </Pressable>
  </View>
);

/** A finished constellation takes no messages; the lead's own thread still does. */
const finished = (view: ConstellationView) =>
  view.state === "completed" || view.state === "archived";

const FinishedComposer = ({ onOpenLead }: { readonly onOpenLead: () => void }) => (
  <Pressable accessibilityRole="button" onPress={onOpenLead} style={styles.finished}>
    <Text style={styles.meta}>This constellation is finished.</Text>
    <Text style={styles.finishedAction}>Message the lead in its thread</Text>
  </Pressable>
);

const LeadNote = ({ lead, now }: { readonly lead: LeadSession; readonly now: number }) =>
  lead.lastMessage === null ? null : (
    <View style={styles.note}>
      <View style={[styles.noteAvatar, { backgroundColor: harnessHue(lead.harness) }]} />
      <View style={styles.leadText}>
        <Text style={styles.meta}>
          Lead{lead.lastMessage.at === null ? "" : ` · ${age(lead.lastMessage.at, now)} ago`}
        </Text>
        <MarkdownLine text={lead.lastMessage.text} style={styles.noteText} numberOfLines={4} />
      </View>
    </View>
  );

const Rail = ({
  view,
  onToggle,
  verdicts,
  keyOf,
}: {
  readonly view: ConstellationView;
  readonly onToggle: (group: string, open: boolean) => void;
  readonly verdicts: Verdicts;
  readonly keyOf: (taskId: string) => string;
}) => {
  const [choices, setChoice] = useKept(claimChoices);

  return (
    <View style={styles.rail}>
      {view.rows.map((row, i) => {
        if (row.kind === "group")
          return (
            <GroupHeader
              key={`group:${row.name}`}
              group={row}
              onToggle={() => onToggle(row.name, !row.open)}
            />
          );

        const previous = view.rows[i - 1];

        return (
          <TaskRowView
            key={row.id}
            row={row}
            first={previous === undefined || previous.kind === "group"}
            last={i === view.rows.length - 1}
            delivery={verdicts.find(row)}
            onVerdict={verdicts.send(row)}
            onCancel={() => verdicts.cancel(row)}
            unsent={choices.get(keyOf(row.id)) ?? null}
            onUnsent={(next) => setChoice(keyOf(row.id), next)}
          />
        );
      })}
    </View>
  );
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
  const now = useNow(30_000);
  const [opened, setOpened] = useState<ReadonlyMap<string, boolean>>(new Map());
  const lead = useLeadInput(constellationKey(connection.hostId, constellationId));
  const navigation = useNavigation();

  const view = useMemo(
    () => (feed.kind === "live" ? constellationView(feed.source, now, opened) : null),
    [feed, now, opened]
  );

  if (feed.kind === "failed") return <Text style={[styles.meta, styles.pad]}>{feed.message}</Text>;

  if (view === null || feed.kind !== "live")
    return (
      <Text style={[styles.meta, styles.pad]}>
        {awayLine(status) ?? "Loading the constellation…"}
      </Text>
    );

  const openLead = () =>
    navigation.push({
      screen: "thread",
      hostId: connection.hostId,
      sessionId: view.leadSessionId,
    });

  return (
    <KeyboardAvoidingView style={styles.fill} behavior="padding">
      <Header
        view={view}
        lead={feed.lead}
        status={status}
        hostName={connection.name}
        onBack={onBack}
        onOpenLead={openLead}
      />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Rail
          view={view}
          onToggle={(group, open) => setOpened((m) => new Map(m).set(group, open))}
          verdicts={verdicts}
          keyOf={(taskId) => taskKey(connection.hostId, constellationId, taskId)}
        />
        {feed.lead === null ? null : <LeadNote lead={feed.lead} now={now} />}
      </ScrollView>
      <View style={styles.composer}>
        {finished(view) ? (
          <FinishedComposer onOpenLead={openLead} />
        ) : (
          <LeadComposer
            harness={feed.lead?.harness ?? null}
            model={feed.lead?.model ?? null}
            disabled={awayLine(status)}
            input={lead}
            onSend={(text) =>
              connection
                .run((client) => messageLead(client, constellationId, text))
                .then(() => undefined)
            }
          />
        )}
      </View>
    </KeyboardAvoidingView>
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

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      {connection === null ? (
        <Text style={[styles.meta, styles.pad]}>This host isn't linked to this iPhone.</Text>
      ) : (
        <Live connection={connection} constellationId={constellationId} onBack={onBack} />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: midnight.bg },
  fill: { flex: 1 },
  pad: { padding: 20 },
  header: {
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: midnight.hairline,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: midnight.surfaceSunken,
    borderColor: midnight.hairline,
    borderWidth: 1,
  },
  backArrow: { fontSize: 22, lineHeight: 24, color: midnight.textDefault },
  titleText: { flex: 1, minWidth: 0, gap: 1 },
  kicker: { flexDirection: "row", alignItems: "center", gap: 7 },
  mark: { width: 14, height: 14 },
  star: { position: "absolute", width: 3, height: 3, backgroundColor: midnight.starlight },
  name: { ...mobileType.title, fontSize: 22, lineHeight: 28, color: midnight.textStrong },
  meta: { ...mobileType.footnote, color: midnight.textSubtle },
  leadRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 4 },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: midnight.surfaceRaised,
  },
  leadText: { flex: 1, minWidth: 0, gap: 1 },
  leadTitle: { ...mobileType.heading, fontSize: 15, lineHeight: 20, color: midnight.textStrong },
  avatarDot: { width: 10, height: 10, borderRadius: 2 },
  barBox: { flexShrink: 0, alignItems: "flex-end", gap: 6 },
  segments: { flexDirection: "row", gap: 3 },
  packed: { width: 104, gap: 1 },
  segment: { width: 10, height: 4 },
  slice: { flex: 1, height: 4 },
  scroll: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 24 },
  rail: {},
  note: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: midnight.hairline,
  },
  noteAvatar: { width: 22, height: 22, borderRadius: 6, opacity: 0.6 },
  noteText: { ...mobileType.callout, color: midnight.textDefault },
  composer: { paddingHorizontal: 16, paddingBottom: 8, paddingTop: 8 },
  finished: {
    gap: 2,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: midnight.surfaceRaised,
  },
  finishedAction: { ...mobileType.callout, color: midnight.textDefault },
});
