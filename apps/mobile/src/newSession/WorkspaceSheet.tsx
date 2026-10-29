/**
 * The workspace sheet (Paper MX-AQ): workspaces grouped by Host, each Host with its Connection
 * State dot and round trip, a Host that isn't connected dimmed; then New worktree.
 */
import { mobileFont, mobileType } from "@polaris/ui/tokens";
import { Match } from "effect";
import { useEffect } from "react";
import { Keyboard, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { StateDot, stateLineColour } from "../hosts/StateDot.tsx";
import { InstrumentSheet, SheetHeader, Well } from "../sheet";
import { themedStyles, useTheme } from "../theme/index.ts";
import { CONTENT_TEXT_SCALE } from "../theme/textScale.ts";
import { displayPath, type SheetHost, type Target } from "./model.ts";

/** "4 ms" while connected; otherwise the state, as Hosts words it. */
export const hostReadout = (host: SheetHost): string =>
  Match.value(host.state).pipe(
    Match.when("connected", () =>
      host.latencyMs === null ? "connected" : `${Math.round(host.latencyMs)} ms`
    ),
    Match.when("needs-attention", () => "needs attention"),
    Match.orElse((state) => state)
  );

const HostGroup = ({
  host,
  target,
  onPick,
}: {
  readonly host: SheetHost;
  readonly target: Target | null;
  readonly onPick: (target: Target) => void;
}) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const workspaces = host.workspaces.filter((w) => !w.hidden);
  const off = !host.connected;

  return (
    <View style={styles.group}>
      <View style={styles.kicker}>
        <Text style={styles.hostName} numberOfLines={1}>
          {host.hostName.toUpperCase()}
        </Text>
        {off ? <StateDot state={host.state} /> : null}
        <Text
          style={[styles.readout, off ? { color: stateLineColour(host.state, colours) } : null]}
        >
          {hostReadout(host)}
        </Text>
      </View>
      <Well style={[styles.well, off ? styles.dim : null]}>
        {workspaces.length === 0 ? (
          <Text style={styles.empty}>No workspaces on {host.hostName}</Text>
        ) : (
          workspaces.map((w, i) => {
            const on = target?.hostId === host.hostId && target.workspaceId === w.id;

            return (
              <Pressable
                key={w.id}
                style={[styles.row, i === 0 ? null : styles.rule]}
                disabled={off}
                onPress={() => onPick({ hostId: host.hostId, workspaceId: w.id })}
                accessibilityRole="button"
                accessibilityState={{ selected: on, disabled: off }}
              >
                <View style={styles.rowText}>
                  <Text style={styles.name} numberOfLines={1}>
                    {w.name}
                  </Text>
                  <Text style={styles.path} numberOfLines={1}>
                    {displayPath(w.path, host.homeDir)}
                    {w.isGitRepo ? "" : " · not a git repo"}
                  </Text>
                </View>
                <Text style={[styles.check, on ? null : styles.hidden]}>✓</Text>
              </Pressable>
            );
          })
        )}
      </Well>
    </View>
  );
};

export const WorkspaceSheet = ({
  open,
  onClose,
  hosts,
  target,
  onPick,
  worktree,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly hosts: ReadonlyArray<SheetHost>;
  readonly target: Target | null;
  readonly onPick: (target: Target) => void;
  /** New worktree for the chosen workspace; null when none is chosen. */
  readonly worktree: {
    readonly on: boolean;
    readonly caption: string;
    readonly enabled: boolean;
    readonly onChange: (on: boolean) => void;
  } | null;
}) => {
  const styles = useStyles();
  const { colours } = useTheme();

  // Nothing here is typed: the composer's keyboard goes down rather than hide New worktree.
  useEffect(() => {
    if (open) Keyboard.dismiss();
  }, [open]);

  return (
    <InstrumentSheet open={open} onClose={onClose} detents={["large"]}>
      <SheetHeader title="Workspace" onClose={onClose} />
      {hosts.map((host) => (
        <HostGroup
          key={host.hostId}
          host={host}
          target={target}
          onPick={(next) => {
            onPick(next);
            onClose();
          }}
        />
      ))}
      {worktree === null ? null : (
        <Well style={styles.worktree}>
          <View style={styles.rowText}>
            <Text style={styles.name}>New worktree</Text>
            <Text
              style={styles.caption}
              numberOfLines={2}
              maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
            >
              {worktree.caption}
            </Text>
          </View>
          <Switch
            value={worktree.on}
            onValueChange={worktree.onChange}
            disabled={!worktree.enabled}
            accessibilityLabel="New worktree"
            trackColor={{ true: colours.textDefault, false: colours.rowSelected }}
            thumbColor={worktree.on ? colours.ground : colours.textSubtle}
            ios_backgroundColor={colours.rowSelected}
          />
        </Well>
      )}
    </InstrumentSheet>
  );
};

const useStyles = themedStyles((colours) => ({
  group: { gap: 8 },
  kicker: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingTop: 6,
  },
  hostName: {
    fontFamily: mobileFont.mono,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "500",
    letterSpacing: 0.88,
    color: colours.textSubtle,
    flex: 1,
  },
  readout: { fontFamily: mobileFont.mono, fontSize: 11, lineHeight: 14, color: colours.textFaint },
  well: { paddingVertical: 0, paddingHorizontal: 0, gap: 0 },
  dim: { opacity: 0.55 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 58,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colours.hairline },
  rowText: { flex: 1, minWidth: 0, gap: 3 },
  name: { ...mobileType.heading, fontWeight: "500", color: colours.textStrong },
  path: { fontFamily: mobileFont.mono, fontSize: 11, lineHeight: 14, color: colours.textFaint },
  caption: { fontFamily: mobileFont.mono, fontSize: 11, lineHeight: 15, color: colours.textSubtle },
  check: { ...mobileType.label, color: colours.textStrong },
  hidden: { opacity: 0 },
  empty: { ...mobileType.footnote, color: colours.textFaint, padding: 14 },
  worktree: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6 },
}));
