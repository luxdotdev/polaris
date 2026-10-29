/**
 * Hosts under Settings (Paper MX-AD): instrument rows grouped "Needs a look" and "Connected",
 * each opening the host details sheet (MX-AE). Routes are chosen on the Mac.
 */
import { mobileFont, mobileType } from "@polaris/ui/tokens";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BackBar } from "../app/BackBar.tsx";
import { type FollowedHostState, useFollowedHosts } from "../home/feed/useFollowedHosts.ts";
import { HORIZON_INSET, HorizonScreen } from "../horizon";
import { hostMenu, LongPressMenu, useMenuActions } from "../menus/index.ts";
import { useRelay } from "../relay/RelayProvider.tsx";
import { Chevron } from "../settings/icons.tsx";
import { themedStyles, useTheme } from "../theme/index.ts";
import { CHROME_TEXT_SCALE, CONTENT_TEXT_SCALE } from "../theme/textScale.ts";
import { DevSegments } from "../home/ui/DevDataToggle.tsx";
import {
  chooseDevHosts,
  DEV_HOST_SHEET,
  type DevHostsData,
  useDevHosts,
  useDevHostsData,
} from "./dev.ts";
import { HostSheet } from "./HostSheet.tsx";
import {
  buildHosts,
  hostDetails,
  type HostInput,
  type HostRowModel,
  type HostSection,
  unlinkNote,
} from "./model.ts";
import { StateDot, stateLineColour } from "./StateDot.tsx";

/** Re-renders each second while a Host reconnects, so "42s" counts. */
const useTicking = (active: boolean) => {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), active ? 1000 : 60_000);

    return () => clearInterval(timer);
  }, [active]);

  return now;
};

const toInput = ({ connection, status, followed }: FollowedHostState): HostInput => ({
  hostId: connection.hostId,
  name: status.host?.hostname ?? connection.name,
  route: connection.route,
  state: status.state,
  failure: status.failure?.detail ?? null,
  latencyMs: status.latencyMs,
  lastSeenAt: status.lastSeenAt,
  sessions: followed.seen
    ? [...followed.state.sessions.values()].filter(({ session }) => session.state !== "archived")
        .length
    : null,
});

const HostRow = ({
  row,
  last,
  onOpen,
}: {
  readonly row: HostRowModel;
  readonly last: boolean;
  readonly onOpen: () => void;
}) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const offline = row.state === "offline";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.name}, ${row.line}, round trip ${row.roundTrip}, ${row.route}`}
      onPress={onOpen}
      style={({ pressed }) => [
        styles.row,
        last ? null : styles.divided,
        pressed ? styles.pressed : null,
      ]}
    >
      <StateDot state={row.state} />
      <View style={styles.text}>
        <Text
          style={[styles.name, offline ? styles.offlineName : null]}
          numberOfLines={1}
          ellipsizeMode="middle"
          maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
        >
          {row.name}
        </Text>
        <Text
          style={[styles.line, { color: stateLineColour(row.state, colours) }]}
          numberOfLines={1}
          maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
        >
          {row.line}
        </Text>
      </View>
      <View style={styles.meter}>
        <Text
          style={[styles.roundTrip, row.state === "connected" ? null : styles.faint]}
          maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
        >
          {row.roundTrip}
        </Text>
        <Text style={styles.route} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
          {row.route}
        </Text>
      </View>
      <Chevron color={colours.textFaint} />
    </Pressable>
  );
};

const Section = ({
  section,
  first,
  onOpen,
}: {
  readonly section: HostSection;
  readonly first: boolean;
  readonly onOpen: (hostId: string) => void;
}) => {
  const styles = useStyles();
  const onMenu = useMenuActions();

  return (
    <>
      <Text
        style={[styles.kicker, first ? null : styles.laterKicker]}
        accessibilityRole="header"
        accessibilityLabel={`${section.title}, ${section.rows.length}`}
        maxFontSizeMultiplier={CHROME_TEXT_SCALE}
      >
        {`${section.title} · ${section.rows.length}`.toUpperCase()}
      </Text>
      <View style={styles.panel}>
        {section.rows.map((row, index) => (
          <LongPressMenu
            key={row.key}
            menu={hostMenu({ hostId: row.key, state: row.state })}
            onAction={onMenu}
          >
            <HostRow
              row={row}
              last={index === section.rows.length - 1}
              onOpen={() => onOpen(row.key)}
            />
          </LongPressMenu>
        ))}
      </View>
    </>
  );
};

const LinkRow = ({ onLink }: { readonly onLink: () => void }) => {
  const styles = useStyles();
  const { colours } = useTheme();

  return (
    <Pressable accessibilityRole="button" onPress={onLink} style={styles.linkRow}>
      <Svg width={14} height={14} viewBox="0 0 14 14">
        <Path
          d="M7 1v12M1 7h12"
          stroke={colours.textDefault}
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      </Svg>
      <Text style={styles.linkText} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
        Link a host
      </Text>
    </Pressable>
  );
};

const DEV_CHOICES: ReadonlyArray<readonly [DevHostsData, string]> = [
  ["paper", "Paper"],
  ["worst", "Worst case"],
  ["offline", "All offline"],
  ["one", "One"],
  ["huge", "64"],
  ["empty", "None"],
];

const DevHostsToggle = ({ bottom }: { readonly bottom: number }) => {
  const data = useDevHostsData();

  return data === null ? null : (
    <DevSegments choices={DEV_CHOICES} value={data} onChoose={chooseDevHosts} bottom={bottom} />
  );
};

export const HostsScreen = ({
  onBack,
  onLink,
}: {
  readonly onBack: () => void;
  readonly onLink: () => void;
}) => {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const relay = useRelay();
  const followed = useFollowedHosts();
  const dev = useDevHosts();
  const hosts = dev ?? followed.map(toInput);
  const [openId, setOpenId] = useState<string | null>(DEV_HOST_SHEET);
  const [unlinkLeft, setUnlinkLeft] = useState<string | null>(null);
  const now = useTicking(hosts.some(({ state }) => state === "reconnecting"));
  const model = buildHosts(hosts, now);
  const open = hosts.find((host) => host.hostId === openId) ?? null;

  const relayLinked = (host: HostInput) =>
    dev === null ? relay.routeOf(host.hostId) === "relay" : host.route === "relay";

  const unlink = (hostId: string) => () => {
    setOpenId(null);

    if (dev !== null) return;
    void relay
      .unlinkHost(hostId)
      .then((kept) => setUnlinkLeft(unlinkNote(kept.map((host) => host.hostName))));
  };

  return (
    <HorizonScreen>
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <BackBar label="Settings" onBack={onBack} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: HORIZON_INSET }]}>
          <View style={styles.head}>
            <Text
              style={styles.title}
              accessibilityRole="header"
              maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
            >
              Hosts
            </Text>
            <Text style={styles.summary} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
              {model.summary}
            </Text>
          </View>
          <View style={styles.sections}>
            {model.sections.map((section, index) => (
              <Section
                key={section.title}
                section={section}
                first={index === 0}
                onOpen={setOpenId}
              />
            ))}
            <LinkRow onLink={onLink} />
            {unlinkLeft === null ? null : <Text style={styles.note}>{unlinkLeft}</Text>}
          </View>
        </ScrollView>
      </View>
      <HostSheet
        details={open === null ? null : hostDetails(open, now)}
        onClose={() => setOpenId(null)}
        onUnlink={open !== null && relayLinked(open) ? unlink(open.hostId) : null}
      />
      <DevHostsToggle bottom={insets.bottom + 4} />
    </HorizonScreen>
  );
};

const useStyles = themedStyles((colours) => ({
  screen: { flex: 1 },
  content: { paddingTop: 4 },
  head: { paddingHorizontal: 16, paddingBottom: 12, gap: 6 },
  title: { ...mobileType.largeTitle, fontWeight: "600", lineHeight: 41, color: colours.textStrong },
  summary: { ...mobileType.footnote, color: colours.textSubtle, fontVariant: ["tabular-nums"] },
  sections: { paddingHorizontal: 10, gap: 10 },
  kicker: {
    fontFamily: mobileFont.mono,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "500",
    letterSpacing: 0.88,
    color: colours.textSubtle,
    paddingHorizontal: 8,
    paddingTop: 6,
  },
  laterKicker: { paddingTop: 10 },
  panel: {
    backgroundColor: colours.panel,
    borderColor: colours.hairline,
    borderWidth: 1,
    borderRadius: 20,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  divided: { borderBottomWidth: 1, borderBottomColor: colours.hairline },
  pressed: { backgroundColor: colours.raised },
  text: { flex: 1, minWidth: 0 },
  name: { ...mobileType.heading, color: colours.textStrong },
  offlineName: { color: colours.textSubtle },
  line: { ...mobileType.footnote },
  meter: { alignItems: "flex-end", flexShrink: 0 },
  roundTrip: {
    fontFamily: mobileFont.mono,
    fontSize: 13,
    lineHeight: 18,
    color: colours.textDefault,
    fontVariant: ["tabular-nums"],
  },
  faint: { color: colours.textFaint },
  route: { ...mobileType.tab, fontWeight: "400", lineHeight: 15, color: colours.textFaint },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  linkText: { ...mobileType.label, lineHeight: 20, color: colours.textDefault },
  note: { ...mobileType.footnote, color: colours.textFaint, paddingHorizontal: 14 },
}));
