/**
 * Hosts (Paper M7, M9): each Host's Connection State, round trip and route, read only, and this
 * iPhone's notification switch. Routes are chosen on the Mac; no dither on Reconnecting.
 */
import { midnight, mobileType } from "@polaris/ui/tokens";
import type { ConnectionState } from "@polaris/protocol";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BackBar } from "../app/BackBar.tsx";
import { useFollowedHosts } from "../home/feed/useFollowedHosts.ts";
import { SwitchRow } from "../newSession/parts.tsx";
import {
  constellationNotifications,
  useConstellationNotifications,
} from "../push/constellations.ts";
import { buildHosts, type HostRowModel } from "./model.ts";

/** Re-renders each second while a Host reconnects, so "42s" counts. */
const useTicking = (active: boolean) => {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), active ? 1000 : 60_000);

    return () => clearInterval(timer);
  }, [active]);

  return now;
};

const StateDot = ({ state }: { readonly state: ConnectionState }) => (
  <View style={styles.dotSlot}>
    <View
      style={[
        styles.dot,
        state === "connected" || state === "needs-attention" ? styles.dotFilled : null,
        state === "reconnecting" ? styles.dotRing : null,
        state === "offline" ? styles.dotDashed : null,
      ]}
    />
  </View>
);

const HostRow = ({ row }: { readonly row: HostRowModel }) => {
  const offline = row.state === "offline";

  return (
    <View style={[styles.row, row.dimmed ? styles.dimmed : null]} accessible>
      <StateDot state={row.state} />
      <View style={styles.text}>
        <Text style={[styles.name, offline ? styles.offlineName : null]} numberOfLines={1}>
          {row.name}
        </Text>
        <Text style={[styles.line, offline ? styles.offlineLine : null]} numberOfLines={2}>
          {row.line}
        </Text>
      </View>
      <View style={styles.count}>
        <Text style={[styles.countValue, offline ? styles.offlineLine : null]}>{row.count}</Text>
        <Text style={styles.countLabel}>{row.countLabel}</Text>
      </View>
    </View>
  );
};

/** Paper M9: Polaris's own notifications when a constellation needs you, per device. */
const Notifications = () => {
  const on = useConstellationNotifications();

  return (
    <View style={styles.notifications}>
      <Text style={styles.sectionLabel}>Notifications on this iPhone</Text>
      <View style={styles.switchBorder}>
        <SwitchRow
          title="When a constellation needs you"
          caption="A question to you or a claim the lead hands up. Approvals always arrive."
          value={on}
          onValueChange={constellationNotifications.set}
        />
      </View>
      <Text style={styles.footerNote}>
        Your Mac has its own switch, in Settings → Notifications.
      </Text>
    </View>
  );
};

/** The Mac this iPhone is linked to (R4's Linked Devices), with Unlink. */
export interface LinkedTo {
  readonly name: string;
  readonly onUnlink: () => void;
}

const FooterRow = ({
  label,
  action,
  onPress,
}: {
  readonly label: string;
  readonly action: string;
  readonly onPress: () => void;
}) => (
  <View style={styles.footerRow}>
    <Text style={styles.footerTitle} numberOfLines={1}>
      {label}
    </Text>
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={10}>
      <Text style={styles.footerAction}>{action}</Text>
    </Pressable>
  </View>
);

export const HostsScreen = ({
  onBack,
  onLink,
  linkedTo = null,
}: {
  readonly onBack: () => void;
  readonly onLink: () => void;
  readonly linkedTo?: LinkedTo | null;
}) => {
  const insets = useSafeAreaInsets();
  const hosts = useFollowedHosts();
  const now = useTicking(hosts.some(({ status }) => status.state === "reconnecting"));

  const model = buildHosts(
    hosts.map(({ connection, status, followed }) => ({
      hostId: connection.hostId,
      name: status.host?.hostname ?? connection.name,
      route: connection.route,
      state: status.state,
      failure: status.failure?.detail ?? null,
      latencyMs: status.latencyMs,
      lastSeenAt: status.state === "connected" ? null : status.lastSeenAt,
      sessions: followed.seen
        ? [...followed.state.sessions.values()].filter(
            ({ session }) => session.state !== "archived"
          ).length
        : null,
    })),
    now
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <BackBar label="Sessions" onBack={onBack} />
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">
          Hosts
        </Text>
        <Text style={styles.summary}>
          {model.summary.map((part, index) => (
            <Text key={part.text} style={part.emphasis ? styles.emphasis : null}>
              {index > 0 ? " · " : ""}
              {part.text}
            </Text>
          ))}
        </Text>
      </View>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {model.rows.map((row) => (
          <HostRow key={row.key} row={row} />
        ))}
        {linkedTo === null ? null : <Notifications />}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 20) + 10 }]}>
        {linkedTo === null ? (
          <FooterRow label="This iPhone isn't linked to a Mac" action="Link" onPress={onLink} />
        ) : (
          <FooterRow
            label={`Linked to ${linkedTo.name}`}
            action="Unlink"
            onPress={linkedTo.onUnlink}
          />
        )}
        <Text style={styles.footerNote}>
          Hosts you add on your Mac appear here. Each host's route is set in Polaris on the Mac,
          under Remote Access.
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: midnight.bg },
  head: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 18, gap: 6 },
  title: { ...mobileType.largeTitle, lineHeight: 41, color: midnight.textStrong },
  summary: {
    ...mobileType.callout,
    lineHeight: 20,
    color: midnight.textSubtle,
    fontVariant: ["tabular-nums"],
  },
  emphasis: { color: midnight.textDefault },
  list: { flex: 1, borderTopWidth: 1, borderTopColor: midnight.hairline },
  listContent: { paddingHorizontal: 20 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: midnight.hairline,
  },
  dimmed: { opacity: 0.55 },
  dotSlot: { width: 12, height: 12, alignItems: "center", justifyContent: "center" },
  dot: { width: 8, height: 8, borderRadius: 999 },
  dotFilled: { backgroundColor: midnight.textSubtle },
  dotRing: { borderWidth: 1.5, borderColor: midnight.textSubtle },
  dotDashed: { borderWidth: 1.5, borderColor: midnight.textFaint, borderStyle: "dashed" },
  text: { flex: 1, minWidth: 0, gap: 3 },
  name: { ...mobileType.title, color: midnight.textStrong },
  offlineName: { color: midnight.textSubtle },
  line: { ...mobileType.subhead, color: midnight.textSubtle, fontVariant: ["tabular-nums"] },
  offlineLine: { color: midnight.textFaint },
  count: { width: 72, alignItems: "flex-end", gap: 3 },
  countValue: {
    ...mobileType.body,
    color: midnight.textDefault,
    fontVariant: ["tabular-nums"],
  },
  countLabel: { ...mobileType.footnote, fontSize: 12, lineHeight: 16, color: midnight.textFaint },
  footer: {
    borderTopWidth: 1,
    borderTopColor: midnight.hairline,
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 6,
  },
  footerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  footerTitle: { ...mobileType.callout, lineHeight: 20, color: midnight.textDefault },
  footerAction: { ...mobileType.callout, lineHeight: 20, color: midnight.textSubtle },
  footerNote: { ...mobileType.footnote, color: midnight.textFaint },
  notifications: { paddingTop: 28, gap: 8 },
  sectionLabel: { ...mobileType.footnote, color: midnight.textSubtle },
  switchBorder: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: midnight.hairline },
});
