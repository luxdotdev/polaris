/**
 * A claim the lead handed to the user (Paper C2, B2): its question, Accept and Send back.
 * Either opens a one-line reply; sending it records the verdict and tells the lead (Q27).
 */
import { mobileType } from "@polaris/ui/tokens";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { themedStyles, useTheme } from "../theme/index.ts";
import type { Check, HandedClaim } from "./model.ts";
import { cancellable, type Delivery, deliveryLine, editable } from "./outbox.ts";
import { chosen, claimKey, fresh, typed, type Unsent, unsentFor } from "./unsent.ts";
import { canSend, type Verdict } from "./verdict.ts";

export type SendVerdict = (verdict: Verdict, reply: string) => void;

const PLACEHOLDER: Readonly<Record<Verdict, string>> = {
  accept: "Your answer for the lead",
  "send-back": "What should change?",
};

const SEND: Readonly<Record<Verdict, string>> = { accept: "Accept", "send-back": "Send back" };

const HINT: Readonly<Record<Verdict, string>> = {
  accept: "Approves the claim and tells the lead to merge it.",
  "send-back": "Tells the lead to send it back with your answer.",
};

const MARK: Readonly<Record<Check["result"], string>> = { passed: "✓", failed: "✗", reported: "·" };

export const Checks = ({ head, checks }: Pick<HandedClaim, "head" | "checks">) => {
  const styles = useStyles();
  const { colours } = useTheme();

  return (
    <View style={styles.checks}>
      <Text style={styles.sha}>{head}</Text>
      {checks.map((check) => (
        <Text
          key={check.label}
          style={[
            styles.meta,
            check.result === "passed" && { color: colours.acceptedText },
            check.result === "failed" && { color: colours.failedText },
          ]}
        >
          {MARK[check.result]} <Text style={styles.meta}>{check.label}</Text>
        </Text>
      ))}
    </View>
  );
};

const Choose = ({ onChoose }: { readonly onChoose: (verdict: Verdict) => void }) => {
  const styles = useStyles();
  const { colours } = useTheme();

  return (
    <>
      <View style={styles.buttons}>
        <Pressable
          accessibilityRole="button"
          style={[styles.button, styles.primary]}
          onPress={() => onChoose("accept")}
        >
          <Text style={[styles.label, { color: colours.ground }]}>Accept</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={[styles.button, styles.secondary]}
          onPress={() => onChoose("send-back")}
        >
          <Text style={[styles.label, { color: colours.textDefault }]}>Send back</Text>
        </Pressable>
      </View>
      <Text style={styles.caption}>Either one asks for your answer, then tells the lead.</Text>
    </>
  );
};

const Reply = ({
  verdict,
  delivery,
  typedDraft,
  onDraft,
  onSend,
  onCancel,
}: {
  readonly verdict: Verdict;
  readonly delivery: Delivery | null;
  readonly typedDraft: string | null;
  readonly onDraft: (draft: string) => void;
  readonly onSend: (reply: string) => void;
  readonly onCancel: () => void;
}) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const draft = typedDraft ?? delivery?.input.reply ?? "";
  const open = editable(delivery);
  const sending = delivery?.state === "sending";
  // A lost step is retried as it was sent, so its answer stays as the Host may have it.
  const text = open ? draft : (delivery?.input.reply ?? draft);
  const ready = !sending && canSend(verdict, text);
  const failed = delivery?.state === "failed";
  const label = failed && !open ? "Retry" : SEND[verdict];

  return (
    <View style={styles.reply}>
      <View style={styles.field}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={onDraft}
          placeholder={PLACEHOLDER[verdict]}
          placeholderTextColor={colours.textFaint}
          autoFocus={delivery === null}
          editable={open}
          returnKeyType="send"
          submitBehavior="blurAndSubmit"
          onSubmitEditing={() => ready && onSend(text)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          disabled={!ready}
          style={[styles.send, ready ? styles.primary : styles.sendOff]}
          onPress={() => onSend(text)}
        >
          {sending ? (
            <ActivityIndicator size="small" color={colours.ground} />
          ) : (
            <Text style={[styles.label, { color: ready ? colours.ground : colours.textFaint }]}>
              {label}
            </Text>
          )}
        </Pressable>
      </View>
      <View style={styles.replyFoot}>
        <Text style={[styles.caption, failed && { color: colours.failedText }]}>
          {delivery === null ? HINT[verdict] : deliveryLine(delivery)}
        </Text>
        {cancellable(delivery) ? (
          <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={8}>
            <Text style={styles.caption}>Cancel</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
};

/**
 * The claim's verdict: choose, answer, then its delivery from the outbox. A delivery stays
 * here after the claim leaves the user (Accept approved it), until the lead has the answer.
 * The unsent choice and answer belong to one claim; pass `unsent` to keep them outside.
 */
export const HandedClaimActions = ({
  claim,
  delivery,
  onVerdict,
  onCancel,
  unsent: controlled,
  onUnsent,
}: {
  readonly claim: HandedClaim | null;
  readonly delivery: Delivery | null;
  readonly onVerdict: SendVerdict;
  readonly onCancel: () => void;
  readonly unsent?: Unsent | null;
  readonly onUnsent?: (next: Unsent) => void;
}) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const [local, setLocal] = useState<Unsent | null>(null);
  const ref = claim ?? delivery?.input ?? null;
  const key = ref === null ? "" : claimKey(ref);
  const unsent = unsentFor(controlled === undefined ? local : controlled, key);
  const update = (next: Unsent) => (onUnsent === undefined ? setLocal(next) : onUnsent(next));
  const step = unsent.step;
  const verdict = delivery?.input.verdict ?? (step.kind === "reply" ? step.verdict : null);

  return (
    <View style={styles.claim}>
      {claim === null ? null : <Checks head={claim.head} checks={claim.checks} />}
      {claim?.question == null ? null : (
        <Text style={styles.question}>
          <Text style={{ color: colours.needsYouText }}>Asks · </Text>
          {claim.question}
        </Text>
      )}
      {delivery?.state === "delivered" ? (
        <Text style={[styles.caption, { color: colours.acceptedText }]}>
          {deliveryLine(delivery)}
        </Text>
      ) : verdict === null ? (
        <Choose onChoose={(choice) => update(chosen(key, choice))} />
      ) : (
        <Reply
          verdict={verdict}
          delivery={delivery}
          typedDraft={unsent.draft}
          onDraft={(draft) => update(typed(unsent, draft))}
          onSend={(reply) => onVerdict(verdict, reply)}
          onCancel={() => {
            onCancel();
            update(fresh(key));
          }}
        />
      )}
    </View>
  );
};

const useStyles = themedStyles((colours) => ({
  claim: { gap: 6 },
  checks: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  sha: { ...mobileType.index, color: colours.textSubtle },
  meta: { ...mobileType.footnote, color: colours.textSubtle },
  question: { ...mobileType.callout, color: colours.textDefault },
  buttons: { flexDirection: "row", gap: 8, paddingTop: 4 },
  button: { height: 36, borderRadius: 999, justifyContent: "center", paddingHorizontal: 18 },
  primary: { backgroundColor: colours.textStrong },
  secondary: { borderWidth: 1, borderColor: colours.hairline },
  label: { ...mobileType.label },
  caption: {
    fontFamily: mobileType.footnote.fontFamily,
    fontSize: 12,
    lineHeight: 16,
    color: colours.textSubtle,
  },
  reply: { gap: 6, paddingTop: 4 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colours.well,
    borderColor: colours.hairline,
    borderWidth: 1,
    borderRadius: 18,
    paddingLeft: 14,
    paddingRight: 4,
    height: 44,
  },
  input: { ...mobileType.callout, flex: 1, color: colours.textStrong },
  send: {
    height: 34,
    borderRadius: 999,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 14,
    minWidth: 72,
  },
  sendOff: { backgroundColor: colours.raised },
  replyFoot: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
}));
