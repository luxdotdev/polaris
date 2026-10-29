/**
 * The sheet's inner lists: every Host's workspaces (only connected Hosts can be chosen, as on
 * the Desktop App), the Harness choice with its Models, and the Host's permission modes.
 */
import type { HarnessKind, Model, PermissionMode } from "@polaris/protocol";
import { mobileType } from "@polaris/ui/tokens";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { themedStyles } from "../theme/index.ts";
import { type HarnessOption, shortlist } from "./harness.ts";
import { displayPath, type PermissionOption, type SheetHost, type Target } from "./model.ts";
import { HarnessTile } from "./parts.tsx";

const Check = ({ on }: { readonly on: boolean }) => {
  const styles = useStyles();

  return <Text style={[styles.check, on ? null : styles.hidden]}>✓</Text>;
};

export const WorkspacePicker = ({
  hosts,
  target,
  onPick,
}: {
  readonly hosts: ReadonlyArray<SheetHost>;
  readonly target: Target | null;
  readonly onPick: (target: Target) => void;
}) => {
  const styles = useStyles();

  return (
    <ScrollView contentContainerStyle={styles.list}>
      {hosts.map((host) => (
        <View key={host.hostId} style={styles.group}>
          <Text style={styles.section}>
            {host.hostName}
            {host.connected ? null : <Text style={styles.faint}> · not connected</Text>}
          </Text>
          {host.workspaces
            .filter((w) => !w.hidden)
            .map((w) => {
              const on = target?.hostId === host.hostId && target.workspaceId === w.id;

              return (
                <Pressable
                  key={w.id}
                  style={styles.row}
                  disabled={!host.connected}
                  onPress={() => onPick({ hostId: host.hostId, workspaceId: w.id })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: !host.connected }}
                >
                  <View style={styles.rowText}>
                    <Text style={host.connected ? styles.title : styles.titleOff}>{w.name}</Text>
                    <Text style={styles.path} numberOfLines={1}>
                      {displayPath(w.path, host.homeDir)}
                    </Text>
                  </View>
                  <Check on={on} />
                </Pressable>
              );
            })}
          {host.workspaces.every((w) => w.hidden) ? (
            <Text style={styles.faint}>No workspaces on {host.hostName}</Text>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
};

const STATUS = new Map([
  ["ready", "Ready"],
  ["unknown", "Status unknown"],
  ["needs-sign-in", "Needs sign-in on the host"],
]);

const ModelRows = ({
  models,
  model,
  onPick,
}: {
  readonly models: ReadonlyArray<Model>;
  readonly model: Model | null;
  readonly onPick: (model: Model) => void;
}) => {
  const styles = useStyles();

  return models.map((m) => (
    <Pressable
      key={m.id}
      style={styles.row}
      onPress={() => onPick(m)}
      accessibilityRole="button"
      accessibilityState={{ selected: model?.id === m.id }}
    >
      <View style={styles.rowText}>
        <Text style={styles.title}>{m.name}</Text>
        {m.isDefault ? <Text style={styles.faint}>Default</Text> : null}
      </View>
      <Check on={model?.id === m.id || (model === null && m.isDefault)} />
    </Pressable>
  ));
};

export const HarnessPicker = ({
  options,
  harness,
  models,
  model,
  onHarness,
  onModel,
}: {
  readonly options: ReadonlyArray<HarnessOption>;
  readonly harness: HarnessKind | null;
  readonly models: ReadonlyArray<Model>;
  readonly model: Model | null;
  readonly onHarness: (harness: HarnessKind) => void;
  readonly onModel: (model: Model) => void;
}) => {
  const styles = useStyles();
  const [more, setMore] = useState(false);
  const list = harness === null ? null : shortlist(harness, models);

  return (
    <ScrollView contentContainerStyle={styles.list}>
      <View style={styles.group}>
        {options.map((o) => (
          <Pressable
            key={o.kind}
            style={styles.row}
            disabled={!o.startable}
            onPress={() => onHarness(o.kind)}
            accessibilityRole="button"
            accessibilityState={{ selected: o.kind === harness, disabled: !o.startable }}
          >
            <HarnessTile harness={o.kind} />
            <View style={styles.rowText}>
              <Text style={o.startable ? styles.title : styles.titleOff}>{o.name}</Text>
              <Text style={styles.faint}>{STATUS.get(o.status) ?? o.status}</Text>
            </View>
            <Check on={o.kind === harness} />
          </Pressable>
        ))}
      </View>
      {list === null || list.top.length === 0 ? null : (
        <View style={styles.group}>
          <Text style={styles.section}>Model</Text>
          <ModelRows models={list.top} model={model} onPick={onModel} />
          {list.more.length === 0 ? null : more ? (
            <ModelRows models={list.more} model={model} onPick={onModel} />
          ) : (
            <Pressable style={styles.row} onPress={() => setMore(true)} accessibilityRole="button">
              <Text style={styles.subtle}>More models ({list.more.length})</Text>
            </Pressable>
          )}
        </View>
      )}
    </ScrollView>
  );
};

export const PermissionPicker = ({
  options,
  mode,
  onPick,
}: {
  readonly options: ReadonlyArray<PermissionOption>;
  readonly mode: PermissionMode;
  readonly onPick: (mode: PermissionMode) => void;
}) => {
  const styles = useStyles();

  return (
    <ScrollView contentContainerStyle={styles.list}>
      <View style={styles.group}>
        {options.map((p) => (
          <Pressable
            key={p.mode}
            style={styles.row}
            onPress={() => onPick(p.mode)}
            accessibilityRole="button"
            accessibilityState={{ selected: p.mode === mode }}
          >
            <View style={styles.rowText}>
              <Text style={styles.title}>{p.label}</Text>
              <Text style={styles.faint}>{p.detail}</Text>
            </View>
            <Check on={p.mode === mode} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
};

const useStyles = themedStyles((colours) => ({
  list: { gap: 20, paddingBottom: 24 },
  group: { gap: 0 },
  section: { ...mobileType.section, color: colours.textSubtle, paddingBottom: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colours.hairline,
  },
  rowText: { flex: 1, gap: 2, minWidth: 0 },
  title: { ...mobileType.heading, fontWeight: "400", color: colours.textStrong },
  titleOff: { ...mobileType.heading, fontWeight: "400", color: colours.textFaint },
  path: { ...mobileType.footnote, color: colours.textFaint },
  faint: { ...mobileType.footnote, color: colours.textFaint },
  subtle: { ...mobileType.callout, color: colours.textSubtle },
  check: { ...mobileType.heading, color: colours.textStrong, width: 20, textAlign: "right" },
  hidden: { opacity: 0 },
}));
