/**
 * Review's foot (Paper M5): Send back and Accept. Accept shows "Accept paused · 1 critical" and
 * does nothing while a Critical finding is open or the risk summary isn't finished. Send back opens a one-line reply first, so the
 * agent session gets the user's words as its next Turn.
 */
import { midnight, mobileType } from "@polaris/ui/tokens";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { acceptLabel } from "./copy.ts";
import type { AcceptState } from "./model.ts";
import { SeverityGlyph } from "./severity.tsx";

export interface ActionBarProps {
  readonly accept: AcceptState;
  readonly turnNumber: number;
  readonly bottomInset: number;
  readonly notice: string | null;
  readonly onAccept: () => void;
  readonly onSendBack: (reply: string) => void;
}

const Reply = ({ onSend, onCancel }: { onSend: (reply: string) => void; onCancel: () => void }) => {
  const [text, setText] = useState("");
  const ready = text.trim() !== "";

  return (
    <View style={styles.reply}>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="What should change?"
        placeholderTextColor={midnight.textFaint}
        autoFocus
        returnKeyType="send"
        onSubmitEditing={() => ready && onSend(text)}
      />
      <Pressable accessibilityRole="button" style={styles.ghost} onPress={onCancel}>
        <Text style={styles.ghostText}>Cancel</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !ready }}
        disabled={!ready}
        style={[styles.send, !ready && styles.sendOff]}
        onPress={() => onSend(text)}
      >
        <Text style={[styles.sendText, !ready && styles.sendTextOff]}>Send</Text>
      </Pressable>
    </View>
  );
};

export const ActionBar = ({
  accept,
  turnNumber,
  bottomInset,
  notice,
  onAccept,
  onSendBack,
}: ActionBarProps) => {
  const [replying, setReplying] = useState(false);
  const enabled = accept.kind === "ready";

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(bottomInset, 12) }]}>
      {notice === null ? null : <Text style={styles.notice}>{notice}</Text>}
      {replying ? (
        <Reply
          onCancel={() => setReplying(false)}
          onSend={(reply) => {
            setReplying(false);
            onSendBack(reply);
          }}
        />
      ) : null}
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          style={styles.secondary}
          onPress={() => setReplying(true)}
        >
          <Text style={styles.secondaryText}>Send back</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !enabled }}
          disabled={!enabled}
          style={[styles.accept, enabled ? styles.acceptOn : styles.acceptOff]}
          onPress={onAccept}
        >
          {accept.kind === "paused" ? <SeverityGlyph severity="critical" size={9} /> : null}
          <Text style={[styles.acceptText, enabled ? styles.acceptTextOn : styles.acceptTextOff]}>
            {acceptLabel(accept, turnNumber)}
          </Text>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    gap: 10,
    paddingTop: 12,
    paddingHorizontal: 20,
    backgroundColor: `${midnight.bg}f2`,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: midnight.hairline,
  },
  notice: { ...mobileType.footnote, color: midnight.failedText },
  row: { flexDirection: "row", gap: 8 },
  secondary: {
    height: 46,
    paddingHorizontal: 16,
    borderRadius: 999,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: midnight.hairline,
  },
  secondaryText: { ...mobileType.label, color: midnight.textDefault },
  accept: {
    flex: 1,
    height: 46,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
  },
  acceptOn: { backgroundColor: midnight.textStrong },
  acceptOff: { backgroundColor: midnight.surfaceRaised },
  acceptText: { ...mobileType.label },
  acceptTextOn: { color: midnight.bg },
  acceptTextOff: { color: midnight.textSubtle },
  reply: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    ...mobileType.callout,
    flex: 1,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    color: midnight.textDefault,
    backgroundColor: midnight.surfaceSunken,
    borderWidth: 1,
    borderColor: midnight.hairline,
  },
  ghost: { height: 40, justifyContent: "center", paddingHorizontal: 4 },
  ghostText: { ...mobileType.subhead, color: midnight.textSubtle },
  send: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    justifyContent: "center",
    backgroundColor: midnight.textStrong,
  },
  sendOff: { backgroundColor: midnight.surfaceRaised },
  sendText: { ...mobileType.subhead, fontWeight: "500", color: midnight.bg },
  sendTextOff: { color: midnight.textFaint },
});
