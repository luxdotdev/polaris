/**
 * A claim the lead handed to the user (Paper C2, B2): its question, Accept and Send back.
 * Either opens a one-line reply; sending it records the verdict and tells the lead (Q27).
 */
import { midnight, mobileType } from "@polaris/ui/tokens";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Check, HandedClaim } from "./model.ts";
import { canSend, type Verdict } from "./verdict.ts";

export type SendVerdict = (verdict: Verdict, reply: string) => Promise<void>;

type Step =
  | { readonly kind: "choose" }
  | { readonly kind: "reply"; readonly verdict: Verdict; readonly error: string | null }
  | { readonly kind: "sending"; readonly verdict: Verdict };

const PLACEHOLDER: Readonly<Record<Verdict, string>> = {
  accept: "Your answer for the lead",
  "send-back": "What should change?",
};

const SEND: Readonly<Record<Verdict, string>> = { accept: "Accept", "send-back": "Send back" };

const MARK: Readonly<Record<Check["result"], string>> = { passed: "✓", failed: "✗", reported: "·" };

export const Checks = ({ head, checks }: Pick<HandedClaim, "head" | "checks">) => (
  <View style={styles.checks}>
    <Text style={styles.sha}>{head}</Text>
    {checks.map((check) => (
      <Text
        key={check.label}
        style={[
          styles.meta,
          check.result === "passed" && { color: midnight.acceptedText },
          check.result === "failed" && { color: midnight.failedText },
        ]}
      >
        {MARK[check.result]} <Text style={styles.meta}>{check.label}</Text>
      </Text>
    ))}
  </View>
);

const Choose = ({ onChoose }: { readonly onChoose: (verdict: Verdict) => void }) => (
  <>
    <View style={styles.buttons}>
      <Pressable
        accessibilityRole="button"
        style={[styles.button, styles.primary]}
        onPress={() => onChoose("accept")}
      >
        <Text style={[styles.label, { color: midnight.bg }]}>Accept</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={[styles.button, styles.secondary]}
        onPress={() => onChoose("send-back")}
      >
        <Text style={[styles.label, { color: midnight.textDefault }]}>Send back</Text>
      </Pressable>
    </View>
    <Text style={styles.caption}>Either one asks for your answer, then tells the lead.</Text>
  </>
);

const Reply = ({
  verdict,
  error,
  sending,
  onSend,
  onCancel,
}: {
  readonly verdict: Verdict;
  readonly error: string | null;
  readonly sending: boolean;
  readonly onSend: (reply: string) => void;
  readonly onCancel: () => void;
}) => {
  const [text, setText] = useState("");
  const ready = canSend(verdict, text) && !sending;

  return (
    <View style={styles.reply}>
      <View style={styles.field}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={PLACEHOLDER[verdict]}
          placeholderTextColor={midnight.textFaint}
          autoFocus
          editable={!sending}
          returnKeyType="send"
          submitBehavior="blurAndSubmit"
          onSubmitEditing={() => ready && onSend(text)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={SEND[verdict]}
          disabled={!ready}
          style={[styles.send, ready ? styles.primary : styles.sendOff]}
          onPress={() => onSend(text)}
        >
          {sending ? (
            <ActivityIndicator size="small" color={midnight.bg} />
          ) : (
            <Text style={[styles.label, { color: ready ? midnight.bg : midnight.textFaint }]}>
              {SEND[verdict]}
            </Text>
          )}
        </Pressable>
      </View>
      <View style={styles.replyFoot}>
        <Text style={[styles.caption, error !== null && { color: midnight.failedText }]}>
          {error ??
            (verdict === "accept"
              ? "Approves the claim and tells the lead to merge it."
              : "Tells the lead to send it back with your answer.")}
        </Text>
        {sending ? null : (
          <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={8}>
            <Text style={styles.caption}>Cancel</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
};

export const HandedClaimActions = ({
  claim,
  onVerdict,
}: {
  readonly claim: HandedClaim;
  readonly onVerdict: SendVerdict;
}) => {
  const [step, setStep] = useState<Step>({ kind: "choose" });

  const send = (verdict: Verdict, reply: string) => {
    setStep({ kind: "sending", verdict });
    onVerdict(verdict, reply).then(
      () => setStep({ kind: "choose" }),
      (error: Error) =>
        setStep({ kind: "reply", verdict, error: `Couldn't send: ${error.message}` })
    );
  };

  return (
    <View style={styles.claim}>
      <Checks head={claim.head} checks={claim.checks} />
      {claim.question === null ? null : (
        <Text style={styles.question}>
          <Text style={{ color: midnight.needsYouText }}>Asks · </Text>
          {claim.question}
        </Text>
      )}
      {step.kind === "choose" ? (
        <Choose onChoose={(verdict) => setStep({ kind: "reply", verdict, error: null })} />
      ) : (
        <Reply
          verdict={step.verdict}
          error={step.kind === "reply" ? step.error : null}
          sending={step.kind === "sending"}
          onSend={(reply) => send(step.verdict, reply)}
          onCancel={() => setStep({ kind: "choose" })}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  claim: { gap: 6 },
  checks: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  sha: { ...mobileType.index, color: midnight.textSubtle },
  meta: { ...mobileType.footnote, color: midnight.textSubtle },
  question: { ...mobileType.callout, color: midnight.textDefault },
  buttons: { flexDirection: "row", gap: 8, paddingTop: 4 },
  button: { height: 36, borderRadius: 999, justifyContent: "center", paddingHorizontal: 18 },
  primary: { backgroundColor: midnight.textStrong },
  secondary: { borderWidth: 1, borderColor: midnight.hairline },
  label: { ...mobileType.label },
  caption: {
    fontFamily: mobileType.footnote.fontFamily,
    fontSize: 12,
    lineHeight: 16,
    color: midnight.textSubtle,
  },
  reply: { gap: 6, paddingTop: 4 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: midnight.surfaceSunken,
    borderColor: midnight.hairline,
    borderWidth: 1,
    borderRadius: 18,
    paddingLeft: 14,
    paddingRight: 4,
    height: 44,
  },
  input: { ...mobileType.callout, flex: 1, color: midnight.textStrong },
  send: {
    height: 34,
    borderRadius: 999,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 14,
    minWidth: 72,
  },
  sendOff: { backgroundColor: midnight.surfaceRaised },
  replyFoot: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
});
