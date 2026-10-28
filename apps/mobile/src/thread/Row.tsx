/** One row of the thread (M4): a collapsed earlier Turn, a message, or a numbered tool step. */
import { midnight, mobileType } from "@polaris/ui/tokens";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ThreadRow } from "./rows.ts";

/** The Critical diamond: an 8pt square turned 45°. */
export const Diamond = () => <View style={styles.diamond} />;

const Earlier = ({
  row,
  open,
  onToggle,
}: {
  readonly row: Extract<ThreadRow, { kind: "earlier" }>;
  readonly open: boolean;
  readonly onToggle: (turnId: string) => void;
}) => (
  <Pressable
    style={styles.earlier}
    onPress={() => onToggle(row.turnId)}
    accessibilityRole="button"
    accessibilityState={{ expanded: open }}
    accessibilityLabel={`Turn ${row.number}, ${row.title}`}
  >
    <Text style={styles.turnNumber}>Turn {row.number}</Text>
    <Text style={styles.turnTitle} numberOfLines={1}>
      {row.title}
    </Text>
    {row.status === "failed" || row.status === "interrupted" ? (
      <Text style={styles.turnStatus}>{row.status}</Text>
    ) : null}
  </Pressable>
);

const Step = ({
  row,
  critical,
}: {
  readonly row: Extract<ThreadRow, { kind: "step" }>;
  readonly critical: boolean;
}) => (
  <View style={[styles.step, row.last ? styles.stepLast : null]}>
    <Text style={styles.stepIndex}>{row.index}</Text>
    <Text
      style={[styles.stepLabel, row.tone === "active" ? styles.stepActive : null]}
      numberOfLines={1}
    >
      {row.label}
    </Text>
    {critical ? <Diamond /> : null}
    {row.detail === "" ? null : (
      <Text style={row.tone === "failed" ? styles.stepFailed : styles.stepDetail}>
        {row.detail}
      </Text>
    )}
  </View>
);

export interface RowProps {
  readonly row: ThreadRow;
  readonly open: boolean;
  /** Paths an open Critical finding is in. */
  readonly criticalPaths: ReadonlySet<string>;
  readonly onToggle: (turnId: string) => void;
}

const RowView = ({ row, open, criticalPaths, onToggle }: RowProps) => {
  switch (row.kind) {
    case "earlier":
      return <Earlier row={row} open={open} onToggle={onToggle} />;
    case "prompt":
      return (
        <View style={styles.promptLine}>
          <View style={styles.prompt}>
            <Text style={styles.message} selectable>
              {row.text}
            </Text>
          </View>
        </View>
      );
    case "reply":
      return (
        <Text style={[styles.message, styles.reply]} selectable>
          {row.text}
        </Text>
      );
    case "error":
      return <Text style={[styles.message, styles.error]}>{row.text}</Text>;
    case "step":
      return <Step row={row} critical={row.paths.some((path) => criticalPaths.has(path))} />;
  }
};

export const Row = memo(RowView);

const styles = StyleSheet.create({
  diamond: {
    width: 6,
    height: 6,
    margin: 1,
    backgroundColor: midnight.severityCritical,
    transform: [{ rotate: "45deg" }],
  },
  earlier: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 36,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: midnight.hairline,
    marginBottom: 12,
  },
  turnNumber: { ...mobileType.footnote, color: midnight.textFaint },
  turnTitle: { ...mobileType.subhead, color: midnight.textSubtle, flex: 1 },
  turnStatus: { ...mobileType.footnote, color: midnight.failedText },
  promptLine: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 12 },
  prompt: {
    backgroundColor: midnight.surfaceRaised,
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 14,
    maxWidth: "88%",
  },
  message: { ...mobileType.callout, color: midnight.textDefault },
  reply: { lineHeight: 22, marginBottom: 12 },
  error: { color: midnight.failedText, marginBottom: 12 },
  step: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    height: 38,
    paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: midnight.hairline,
  },
  stepLast: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: midnight.hairline,
    marginBottom: 12,
  },
  stepIndex: { ...mobileType.index, color: midnight.textFaint, width: 20 },
  stepLabel: { ...mobileType.subhead, color: midnight.textSubtle, flex: 1 },
  stepActive: { color: midnight.textDefault, fontWeight: "500" },
  stepDetail: { ...mobileType.footnote, color: midnight.textFaint },
  stepFailed: { ...mobileType.footnote, color: midnight.failedText },
});
