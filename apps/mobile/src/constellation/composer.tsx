/** The composer at the foot of the constellation (Paper C2): addressed to the lead. */
import type { HarnessKind } from "@polaris/protocol";
import { midnight, mobileType } from "@polaris/ui/tokens";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { harnessHue } from "./glyphs.tsx";

export const LeadComposer = ({
  harness,
  model,
  disabled,
  onSend,
}: {
  readonly harness: HarnessKind | null;
  readonly model: string | null;
  /** Why it can't send now (the Host is away), or null. */
  readonly disabled: string | null;
  readonly onSend: (text: string) => Promise<void>;
}) => {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = text.trim() !== "" && !sending && disabled === null;
  const hue = harnessHue(harness);

  const send = () => {
    if (!ready) return;
    setSending(true);
    setError(null);
    onSend(text.trim()).then(
      () => {
        setText("");
        setSending(false);
      },
      (failure: Error) => {
        setError(`Couldn't send: ${failure.message}`);
        setSending(false);
      }
    );
  };

  return (
    <View style={styles.box}>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="Message the lead"
        placeholderTextColor={midnight.textFaint}
        multiline
        editable={!sending}
      />
      {error === null && disabled === null ? null : (
        <Text style={[styles.note, error !== null && { color: midnight.failedText }]}>
          {error ?? disabled}
        </Text>
      )}
      <View style={styles.foot}>
        <View style={styles.chip}>
          <View style={[styles.avatar, { backgroundColor: hue }]} />
          <Text style={[styles.chipText, { color: hue }]}>@lead</Text>
          {model === null ? null : <Text style={styles.chipText}>{model}</Text>}
        </View>
        <View style={styles.spacer} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send to the lead"
          disabled={!ready}
          style={[styles.send, ready && styles.sendReady]}
          onPress={send}
        >
          {sending ? (
            <ActivityIndicator size="small" color={midnight.textSubtle} />
          ) : (
            <Text style={[styles.arrow, ready && { color: midnight.bg }]}>↑</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  box: {
    backgroundColor: midnight.surfaceSunken,
    borderColor: midnight.hairline,
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
  },
  input: { ...mobileType.body, fontSize: 16, color: midnight.textStrong, maxHeight: 120 },
  note: { ...mobileType.footnote, color: midnight.textSubtle },
  foot: { flexDirection: "row", alignItems: "center", gap: 10 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    height: 30,
    paddingLeft: 4,
    paddingRight: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: midnight.hairline,
  },
  avatar: { width: 22, height: 22, borderRadius: 6, opacity: 0.6 },
  chipText: { ...mobileType.footnote, lineHeight: 16, color: midnight.textSubtle },
  spacer: { flex: 1 },
  send: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: midnight.surfaceRaised,
  },
  sendReady: { backgroundColor: midnight.textStrong },
  arrow: { ...mobileType.label, color: midnight.textFaint },
});
