/**
 * The needs you inbox (Paper MX-H): the oldest request in the hero well, the rest in wells under
 * "Also waiting on you", each answered in place, and every Host's state in the footer.
 */
import { mobileType } from "@polaris/ui/tokens";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { HeroWell, InstrumentSheet, SheetHeader, StatusFooter, Well } from "../sheet";
import { type MobileColours, useTheme } from "../theme";
import type { FooterHost, Inbox } from "./model.ts";
import { NeedsYouCard } from "./NeedsYouCard.tsx";

const DETENTS = ["medium", "large"] as const;

const Empty = ({ working }: { readonly working: string | null }) => {
  const { colours } = useTheme();

  return (
    <View style={styles.empty}>
      <Text style={[styles.emptyTitle, { color: colours.textStrong }]}>Nothing needs you</Text>
      {working === null ? null : (
        <Text style={[styles.emptyLine, { color: colours.textSubtle }]}>{working}</Text>
      )}
    </View>
  );
};

const dotColour = (colours: MobileColours, connection: FooterHost["connection"]) =>
  ({
    connected: colours.diffAddedText,
    reconnecting: colours.needsYou,
    "needs-attention": colours.failed,
    offline: colours.textFaint,
  })[connection];

const Footer = ({ inbox }: { readonly inbox: Inbox }) => {
  const { colours } = useTheme();

  return (
    <StatusFooter>
      <View style={styles.footer}>
        {inbox.hosts.map((host) => (
          <View key={host.hostId} style={styles.footerHost}>
            <View style={[styles.dot, { backgroundColor: dotColour(colours, host.connection) }]} />
            <Text style={[styles.footerText, { color: colours.textSubtle }]} numberOfLines={1}>
              {host.label}
            </Text>
          </View>
        ))}
        <View style={styles.spacer} />
        {inbox.away ? (
          <Text style={[styles.footerText, { color: colours.textFaint }]}>
            answer when it's back
          </Text>
        ) : null}
      </View>
    </StatusFooter>
  );
};

const Requests = ({ inbox }: { readonly inbox: Inbox }) => {
  const { colours } = useTheme();
  const [first, ...rest] = inbox.items;

  if (first === undefined) return <Empty working={inbox.working} />;

  return (
    <ScrollView contentContainerStyle={styles.list}>
      <HeroWell>
        <NeedsYouCard item={first} hostId={first.hostId} />
      </HeroWell>
      {rest.length === 0 ? null : (
        <Text style={[styles.kicker, { color: colours.textSubtle }]} accessibilityRole="header">
          {`ALSO WAITING ON YOU · ${rest.length}`}
        </Text>
      )}
      {rest.map((item) => (
        <Well key={item.key}>
          <NeedsYouCard item={item} hostId={item.hostId} />
        </Well>
      ))}
    </ScrollView>
  );
};

export const InboxSheet = ({
  open,
  inbox,
  onClose,
}: {
  readonly open: boolean;
  readonly inbox: Inbox;
  readonly onClose: () => void;
}) => (
  <InstrumentSheet open={open} onClose={onClose} detents={DETENTS}>
    <SheetHeader title="Needs you" kicker={String(inbox.count)} onClose={onClose} />
    <View style={styles.body}>
      <Requests inbox={inbox} />
    </View>
    <Footer inbox={inbox} />
  </InstrumentSheet>
);

const styles = StyleSheet.create({
  body: { flex: 1 },
  list: { gap: 10, paddingHorizontal: 10, paddingBottom: 16 },
  kicker: {
    ...mobileType.index,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "500",
    letterSpacing: 0.88,
    paddingHorizontal: 8,
    paddingTop: 6,
  },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2 },
  emptyTitle: { ...mobileType.subhead, fontWeight: "500", lineHeight: 20 },
  emptyLine: { ...mobileType.footnote, fontSize: 12, lineHeight: 16 },
  footer: { flexDirection: "row", alignItems: "center", gap: 8 },
  footerHost: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  footerText: { ...mobileType.index, fontSize: 11, lineHeight: 14 },
  spacer: { flex: 1 },
});
