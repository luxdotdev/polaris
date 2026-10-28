/** The sheet's rows (Paper M6): labelled pickers, switches and the Harness chip. */
import type { HarnessKind } from "@polaris/protocol";
import { midnight, mobileType } from "@polaris/ui/tokens";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";

const HARNESS_HUE = new Map([
  ["claude", midnight.harnessClaudeCode],
  ["codex", midnight.harnessCodex],
  ["opencode", midnight.harnessOpencode],
]);

/** A Harness's tile: its hue at 18% behind a 4×4 pixel check (rule: hue only on the tile). */
export const HarnessTile = ({ harness }: { readonly harness: HarnessKind }) => {
  const hue = HARNESS_HUE.get(harness) ?? midnight.textSubtle;

  return (
    <View style={[styles.tile, { backgroundColor: `${hue}2e` }]}>
      <View style={styles.check}>
        {Array.from({ length: 16 }, (_, cell) => (
          <View
            key={cell}
            style={[
              styles.cell,
              { backgroundColor: (cell + Math.floor(cell / 4)) % 2 === 0 ? hue : "transparent" },
            ]}
          />
        ))}
      </View>
    </View>
  );
};

export const Chevron = ({ down = false }: { readonly down?: boolean }) => (
  <Text style={[styles.chevron, down ? styles.chevronDown : null]}>›</Text>
);

/** "Workspace  polaris / Mac Studio · last used  ›". */
export const PickerRow = ({
  label,
  onPress,
  disabled = false,
  children,
}: {
  readonly label: string;
  readonly onPress?: () => void;
  readonly disabled?: boolean;
  readonly children: ReactNode;
}) => (
  <Pressable
    style={styles.pickerRow}
    onPress={onPress}
    disabled={disabled || onPress === undefined}
    accessibilityRole="button"
    accessibilityLabel={label}
  >
    <Text style={styles.rowLabel}>{label}</Text>
    <View style={styles.rowValue}>{children}</View>
    {onPress === undefined ? null : <Chevron />}
  </Pressable>
);

/** A title, a caption saying what it means now, and an iOS switch. */
export const SwitchRow = ({
  title,
  caption,
  value,
  onValueChange,
  disabled = false,
}: {
  readonly title: string;
  readonly caption: string;
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
  readonly disabled?: boolean;
}) => (
  <View style={styles.switchRow}>
    <View style={styles.rowValue}>
      <Text style={styles.value}>{title}</Text>
      <Text style={styles.caption}>{caption}</Text>
    </View>
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      accessibilityLabel={title}
      trackColor={{ true: midnight.textDefault, false: midnight.rowSelected }}
      thumbColor={value ? midnight.bg : midnight.textSubtle}
      ios_backgroundColor={midnight.rowSelected}
    />
  </View>
);

/** The Harness picker chip: tile, `@claude`, the Model, a chevron (DESIGN.md, Harness picker). */
export const HarnessChip = ({
  harness,
  model,
  onPress,
}: {
  readonly harness: HarnessKind;
  readonly model: string;
  readonly onPress: () => void;
}) => (
  <Pressable
    style={styles.chip}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={`Harness @${harness}, ${model}`}
  >
    <HarnessTile harness={harness} />
    <Text style={styles.chipHandle}>@{harness}</Text>
    <Text style={styles.chipModel} numberOfLines={1}>
      {model}
    </Text>
    <Chevron down />
  </Pressable>
);

export const styles = StyleSheet.create({
  tile: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  check: { width: 12, height: 12, flexDirection: "row", flexWrap: "wrap" },
  cell: { width: 3, height: 3 },
  chevron: { ...mobileType.heading, color: midnight.textFaint },
  chevronDown: { transform: [{ rotate: "90deg" }] },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 60,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: midnight.hairline,
  },
  rowLabel: { ...mobileType.callout, lineHeight: 20, color: midnight.textSubtle, width: 96 },
  rowValue: { flex: 1, gap: 2, minWidth: 0 },
  value: { ...mobileType.heading, fontWeight: "400", color: midnight.textStrong },
  caption: { ...mobileType.footnote, lineHeight: 17, color: midnight.textFaint },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 66,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: midnight.hairline,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    height: 34,
    paddingLeft: 6,
    paddingRight: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#ffffff1f",
    backgroundColor: midnight.surfaceRaised,
    maxWidth: "100%",
  },
  chipHandle: { ...mobileType.callout, lineHeight: 20, color: midnight.textStrong },
  chipModel: { ...mobileType.footnote, color: midnight.textSubtle, flexShrink: 1 },
});
