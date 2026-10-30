/**
 * A Secret Request in the composer's strip (ADR 0089): the agent's label and reason, a masked
 * one-line field, Save securely and Decline. The value lives only in this field until it's sent.
 */
import type { ApprovalRequest } from "@polaris/protocol";
import { mobileType } from "@polaris/ui/tokens";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import type { SecretOutcome } from "./fold.ts";
import { haptics } from "../motion";
import { useTheme } from "../theme";
import { CONTENT_TEXT_SCALE, CONTROL_TEXT_SCALE } from "../theme/textScale.ts";
import { canSave, SECRET_FOOTER, SECRET_OUTCOMES, SECRET_PLACEHOLDER } from "./secret.ts";

export interface SecretCardProps {
  readonly request: ApprovalRequest;
  /** "Claude Code asks for a secret". */
  readonly headline: string;
  readonly live: boolean;
  readonly onProvide: (typed: string) => void;
  readonly onDecline: () => void;
}

const Lock = ({ colour }: { readonly colour: string }) => (
  <Svg width={12} height={12} viewBox="0 0 12 12">
    <Path
      d="M3.5 5V3.75a2.5 2.5 0 0 1 5 0V5M2.75 5h6.5v5.25h-6.5z"
      stroke={colour}
      strokeWidth={1.2}
      fill="none"
      strokeLinejoin="round"
    />
  </Svg>
);

const Pill = ({
  label,
  filled,
  live,
  onPress,
}: {
  readonly label: string;
  readonly filled: boolean;
  readonly live: boolean;
  readonly onPress: () => void;
}) => {
  const { colours } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !live }}
      disabled={!live}
      onPress={onPress}
      hitSlop={6}
      style={[
        styles.pill,
        filled ? { backgroundColor: colours.textStrong } : styles.quiet,
        live ? null : styles.waiting,
      ]}
    >
      <Text
        style={[styles.pillLabel, { color: filled ? colours.bg : colours.textSubtle }]}
        maxFontSizeMultiplier={CONTROL_TEXT_SCALE}
      >
        {label}
      </Text>
    </Pressable>
  );
};

export const SecretCard = ({ request, headline, live, onProvide, onDecline }: SecretCardProps) => {
  const { colours } = useTheme();
  const [typed, setTyped] = useState("");
  const ready = live && canSave(typed);

  const save = () => {
    if (!ready) return;
    haptics.approve();
    onProvide(typed);
    // Gone from the phone once it's on its way; a refusal asks for it again.
    setTyped("");
  };

  return (
    <View style={styles.column}>
      <View style={styles.row}>
        <Lock colour={colours.needsYou} />
        <Text
          style={[styles.headline, { color: colours.needsYouText }]}
          maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
        >
          {headline}
        </Text>
      </View>
      <Text
        style={[styles.label, { color: colours.textStrong }]}
        maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
      >
        {request.title}
      </Text>
      {request.detail === null || request.detail.trim() === "" ? null : (
        <Text
          style={[styles.reason, { color: colours.textSubtle }]}
          maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
        >
          {request.detail}
        </Text>
      )}
      <TextInput
        accessibilityLabel={request.title}
        value={typed}
        onChangeText={setTyped}
        editable={live}
        secureTextEntry
        autoComplete="off"
        textContentType="none"
        autoCorrect={false}
        autoCapitalize="none"
        spellCheck={false}
        importantForAutofill="no"
        multiline={false}
        returnKeyType="done"
        onSubmitEditing={save}
        placeholder={request.placeholder ?? SECRET_PLACEHOLDER}
        placeholderTextColor={colours.textFaint}
        maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
        style={[
          styles.field,
          { color: colours.textStrong, borderColor: colours.hairline, backgroundColor: colours.bg },
        ]}
      />
      <View style={styles.buttons}>
        <Pill label="Save securely" filled live={ready} onPress={save} />
        <Pill label="Decline" filled={false} live={live} onPress={onDecline} />
      </View>
      <Text
        style={[styles.footer, { color: colours.textFaint }]}
        maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
      >
        {SECRET_FOOTER}
      </Text>
    </View>
  );
};

/** "Tailscale auth key · Saved securely and kept private", once the request has ended. */
export const SecretSettled = ({ settled }: { readonly settled: SecretOutcome }) => {
  const { colours } = useTheme();

  return (
    <View style={styles.row} accessibilityLiveRegion="polite">
      <Lock colour={colours.textSubtle} />
      <Text
        style={[styles.settled, { color: colours.textSubtle }]}
        numberOfLines={2}
        maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
      >
        <Text style={{ color: colours.textDefault }}>{settled.request.title}</Text>
        {` · ${SECRET_OUTCOMES[settled.outcome]}`}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  column: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 24 },
  headline: { ...mobileType.footnote, fontSize: 12, lineHeight: 16, fontWeight: "500", flex: 1 },
  label: { ...mobileType.subhead, fontWeight: "500" },
  reason: { ...mobileType.footnote },
  field: {
    ...mobileType.callout,
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  buttons: { flexDirection: "row", alignItems: "center", gap: 4 },
  pill: {
    minHeight: 30,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  quiet: { paddingHorizontal: 7 },
  pillLabel: { ...mobileType.footnote, lineHeight: 16, fontWeight: "500" },
  waiting: { opacity: 0.55 },
  footer: { ...mobileType.footnote, fontSize: 12, lineHeight: 16 },
  settled: { ...mobileType.footnote, flex: 1 },
});
