/** The composer at the foot of the constellation (Paper C2): addressed to the lead. */
import type { HarnessKind } from "@polaris/protocol";
import { mobileType } from "@polaris/ui/tokens";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import type { useLeadInput } from "../duo/kept.ts";
import { themedStyles, useTheme } from "../theme/index.ts";
import { harnessHue } from "./glyphs.tsx";

export const LeadComposer = ({
  harness,
  model,
  disabled,
  onSend,
  input,
}: {
  readonly harness: HarnessKind | null;
  readonly model: string | null;
  /** Why it can't send now (the Host is away), or null. */
  readonly disabled: string | null;
  readonly onSend: (text: string) => Promise<void>;
  /** The draft and its Send, kept above this composer so every arrangement sees the same. */
  readonly input: ReturnType<typeof useLeadInput>;
}) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const { text, sending, error } = input;
  const ready = text.trim() !== "" && !sending && disabled === null;
  const hue = harnessHue(colours, harness);

  const send = () => {
    if (ready) input.send(onSend);
  };

  return (
    <View style={styles.box}>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={input.type}
        placeholder="Message the lead"
        placeholderTextColor={colours.textFaint}
        multiline
      />
      {error === null && disabled === null ? null : (
        <Text style={[styles.note, error !== null && { color: colours.failedText }]}>
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
            <ActivityIndicator size="small" color={colours.textSubtle} />
          ) : (
            <Text style={[styles.arrow, ready && { color: colours.ground }]}>↑</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  box: {
    backgroundColor: colours.panel,
    borderColor: colours.hairline,
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
  },
  input: { ...mobileType.body, fontSize: 16, color: colours.textStrong, maxHeight: 120 },
  note: { ...mobileType.footnote, color: colours.textSubtle },
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
    borderColor: colours.hairline,
  },
  avatar: { width: 22, height: 22, borderRadius: 6, opacity: 0.6 },
  chipText: { ...mobileType.footnote, lineHeight: 16, color: colours.textSubtle },
  spacer: { flex: 1 },
  send: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colours.raised,
  },
  sendReady: { backgroundColor: colours.textStrong },
  arrow: { ...mobileType.label, color: colours.textFaint },
}));
