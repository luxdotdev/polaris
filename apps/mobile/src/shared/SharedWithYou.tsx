/**
 * Home's Shared with you (DESIGN.md "Shared Sessions", SS4 on the phone): each unanswered Invite
 * with Open and Decline, then the sessions others shared, grouped by owner with their role and
 * "Host offline". Nothing shows until something is shared (rule/solo-is-unchanged).
 */
import { mobileFont, mobileType, mobileWeight } from "@polaris/ui/tokens";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import type { HostConnection } from "../runtime/hostConnection.ts";
import { useHostRegistry } from "../runtime/hosts.tsx";
import { themedStyles } from "../theme/index.ts";
import { CHROME_TEXT_SCALE, CONTENT_TEXT_SCALE } from "../theme/textScale.ts";
import { type InviteRow, inviteRows, type SharedRow, sharedGroups } from "./invites.ts";
import { useShared } from "./SharedProvider.tsx";

const InviteCard = ({
  row,
  onOpen,
}: {
  readonly row: InviteRow;
  readonly onOpen: (hostKey: string, sessionId: string) => void;
}) => {
  const styles = useStyles();
  const shared = useShared();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const isSession = row.invite.share.kind === "session";

  const open = async () => {
    setBusy(true);
    const outcome = await shared.accept(row);
    setBusy(false);

    if ("failure" in outcome) setFailure(outcome.failure);
    else if (isSession) onOpen(outcome.hostKey, row.invite.share.id);
  };

  const decline = async () => {
    setBusy(true);
    setFailure(await shared.decline(row));
    setBusy(false);
  };

  return (
    <View style={styles.well}>
      <Text style={styles.title} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
        {`${row.owner} shared `}
        <Text style={styles.italic}>{row.title}</Text>
        {" with you"}
      </Text>
      <Text style={styles.meta} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
        {[row.role, row.through, row.credit].filter((part) => part !== null).join(" · ")}
      </Text>
      {failure === null ? null : (
        <Text style={styles.meta} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
          {failure}
        </Text>
      )}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void open()}
          style={({ pressed }) => [styles.button, styles.primary, pressed && styles.pressed]}
        >
          <Text style={styles.primaryText} maxFontSizeMultiplier={CHROME_TEXT_SCALE}>
            {busy ? "Opening…" : "Open"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void decline()}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={styles.buttonText} maxFontSizeMultiplier={CHROME_TEXT_SCALE}>
            Decline
          </Text>
        </Pressable>
      </View>
    </View>
  );
};

const SharedSessionRow = ({
  row,
  onOpen,
}: {
  readonly row: SharedRow;
  readonly onOpen: (hostKey: string, sessionId: string) => void;
}) => {
  const styles = useStyles();

  const line = [
    row.role,
    row.offline ? "Host offline" : null,
    row.opens ? null : "Opens in the desktop app",
    row.through,
  ]
    .filter((part) => part !== null)
    .join(" · ");

  return (
    <Pressable
      accessibilityRole="button"
      disabled={!row.opens}
      onPress={() => onOpen(row.hostKey, row.share.share.id)}
      style={({ pressed }) => [styles.well, pressed && styles.pressed]}
    >
      <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
        {row.title}
      </Text>
      <Text style={styles.meta} numberOfLines={1} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
        {line}
      </Text>
    </Pressable>
  );
};

/** Under Home's own sessions; opens a shared session's thread by its Host's Share key. */
/** The shared Hosts that can't be reached now, kept current as each connection's status changes. */
const useOfflineHosts = (connections: ReadonlyArray<HostConnection>) => {
  const subscribe = useCallback(
    (listener: () => void) => {
      const stops = connections.map((connection) => connection.subscribe(listener));

      return () => stops.forEach((stop) => stop());
    },
    [connections]
  );

  const down = useSyncExternalStore(subscribe, () =>
    connections
      .flatMap((c) =>
        c.status().state !== "connected" && c.status().attempt > 0 ? [c.hostId] : []
      )
      .join("\n")
  );

  return useMemo(() => {
    const keys = new Set(down.split("\n"));

    return (hostKey: string) => keys.has(hostKey);
  }, [down]);
};

export const SharedWithYou = ({
  onOpen,
}: {
  readonly onOpen: (hostKey: string, sessionId: string) => void;
}) => {
  const styles = useStyles();
  const shared = useShared();
  const { shared: connections } = useHostRegistry();

  const offline = useOfflineHosts(connections);

  const invites = inviteRows(shared.accounts, shared.invites);
  const groups = sharedGroups(shared.accepted, shared.accounts, offline);

  if (invites.length === 0 && groups.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text
        style={styles.kicker}
        accessibilityRole="header"
        maxFontSizeMultiplier={CHROME_TEXT_SCALE}
      >
        Shared with you
      </Text>
      {invites.map((row) => (
        <InviteCard key={row.key} row={row} onOpen={onOpen} />
      ))}
      {groups.map((group) => (
        <View key={group.key} style={styles.group}>
          <Text style={styles.owner} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
            {group.owner}
          </Text>
          {group.rows.map((row) => (
            <SharedSessionRow key={row.share.inviteId} row={row} onOpen={onOpen} />
          ))}
        </View>
      ))}
    </View>
  );
};

const useStyles = themedStyles((c) => ({
  section: { gap: 6, paddingTop: 16 },
  kicker: {
    fontFamily: mobileFont.mono,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: mobileWeight.medium,
    letterSpacing: 0.88,
    textTransform: "uppercase",
    color: c.textSubtle,
    paddingHorizontal: 8,
    paddingBottom: 2,
  },
  group: { gap: 6 },
  owner: { ...mobileType.section, color: c.textDefault, paddingHorizontal: 8, paddingTop: 6 },
  well: {
    backgroundColor: c.panel,
    borderColor: c.hairline,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 4,
  },
  pressed: { backgroundColor: c.raised },
  title: { ...mobileType.heading, color: c.textStrong },
  italic: { fontStyle: "italic" },
  meta: { ...mobileType.footnote, color: c.textSubtle },
  actions: { flexDirection: "row", gap: 8, paddingTop: 6 },
  button: {
    height: 34,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.hairline,
    justifyContent: "center",
  },
  primary: { backgroundColor: c.starlight, borderColor: c.starlight },
  buttonText: { ...mobileType.label, color: c.textDefault },
  primaryText: { ...mobileType.label, color: c.ground },
}));
