/**
 * The instrument sheet's layout parts (DESIGN.md, Menus and popovers: instrument cards; Paper
 * MX-H): a header with at most one control, a hero well, wells, mono kickers, a status footer.
 */
import { mobileFont, mobileType } from "@polaris/ui/tokens";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useTheme } from "../theme";

const CloseGlyph = ({ color }: { readonly color: string }) => (
  <Svg width={12} height={12} viewBox="0 0 12 12">
    <Path d="M3 3l6 6M9 3l-6 6" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
  </Svg>
);

export interface SheetHeaderProps {
  readonly title: string;
  /** One count or state word after the title, in mono ("2"). */
  readonly kicker?: string | number;
  /** A small glyph before the title (the needs you star, a Harness mark). */
  readonly mark?: ReactNode;
  /** The close button; leave it out for a sheet that closes only by drag. */
  readonly onClose?: () => void;
  /** At most one control at the trailing edge, in place of close. */
  readonly control?: ReactNode;
}

/** MX-H's header: mark, title, mono kicker, and close (or one control) at the trailing edge. */
export const SheetHeader = ({ title, kicker, mark, onClose, control }: SheetHeaderProps) => {
  const { colours } = useTheme();

  return (
    <View style={styles.header}>
      {mark === undefined ? null : <View style={styles.mark}>{mark}</View>}
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={[styles.title, { color: colours.textStrong }]}
      >
        {title}
      </Text>
      {kicker === undefined ? null : (
        <Text style={[styles.count, { color: colours.textSubtle }]}>{kicker}</Text>
      )}
      <View style={styles.spacer} />
      {control ??
        (onClose === undefined ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={7}
            onPress={onClose}
            style={({ pressed }) => [
              styles.close,
              { backgroundColor: colours.raised },
              pressed && styles.pressed,
            ]}
          >
            <CloseGlyph color={colours.textSubtle} />
          </Pressable>
        ))}
    </View>
  );
};

interface WellProps {
  readonly children?: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}

/** The picture or the subject at the sheet's top, on the raised surface (MX-H's hero card). */
export const HeroWell = ({ children, style }: WellProps) => {
  const { colours } = useTheme();

  return (
    <View
      style={[
        styles.hero,
        { backgroundColor: colours.raised, borderColor: colours.hairline },
        style,
      ]}
    >
      {children}
    </View>
  );
};

/** An inset well for rows and readouts. */
export const Well = ({ children, style }: WellProps) => {
  const { colours } = useTheme();

  return (
    <View
      style={[styles.well, { backgroundColor: colours.well, borderColor: colours.hairline }, style]}
    >
      {children}
    </View>
  );
};

/** Mono caps with `·` between parts, for data labels only ("ALSO WAITING ON YOU · 1"). */
export const SheetKicker = ({ parts }: { readonly parts: ReadonlyArray<string | number> }) => {
  const { colours } = useTheme();

  return (
    <View style={styles.kickerRow}>
      <Text style={[styles.kicker, { color: colours.textSubtle }]}>
        {parts.join(" · ").toUpperCase()}
      </Text>
    </View>
  );
};

export interface StatusFooterProps {
  /** The mono status line as text. */
  readonly status?: string;
  /** Or the status line laid out as given (`StatusItem`s). */
  readonly children?: ReactNode;
  /** A quiet trailing note ("answers queue"). */
  readonly note?: string;
  /** At most one action at the trailing edge. */
  readonly action?: ReactNode;
}

/** The footer bar under a hairline: a mono status line and at most one action. */
export const StatusFooter = ({ status, children, note, action }: StatusFooterProps) => {
  const { colours } = useTheme();

  return (
    <View style={[styles.footer, { borderTopColor: colours.hairline }]}>
      <View style={styles.statusLine}>
        {status === undefined ? null : (
          <Text numberOfLines={1} style={[styles.status, { color: colours.textSubtle }]}>
            {status}
          </Text>
        )}
        {children}
      </View>
      {note === undefined ? null : (
        <Text style={[styles.status, { color: colours.textFaint }]}>{note}</Text>
      )}
      {action}
    </View>
  );
};

/** A status footer's dot and label ("● mac-studio"); the dot's colour carries the state. */
export const StatusItem = ({
  color,
  label,
}: {
  readonly color: string;
  readonly label: string;
}) => {
  const { colours } = useTheme();

  return (
    <View style={styles.item}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text numberOfLines={1} style={[styles.status, { color: colours.textSubtle }]}>
        {label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    paddingBottom: 2,
  },
  mark: { alignItems: "center", justifyContent: "center" },
  title: {
    fontFamily: mobileFont.sans,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "500",
    flexShrink: 1,
  },
  count: { fontFamily: mobileFont.mono, fontSize: 12, lineHeight: 16 },
  spacer: { flex: 1 },
  close: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { transform: [{ scale: 0.94 }] },
  hero: { borderRadius: 18, borderWidth: 1, padding: 14 },
  well: {
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 8,
  },
  kickerRow: { paddingHorizontal: 8, paddingTop: 6 },
  kicker: {
    fontFamily: mobileFont.mono,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "500",
    letterSpacing: 0.88,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  statusLine: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
  status: { ...mobileType.index, fontSize: 11, lineHeight: 14 },
  item: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
