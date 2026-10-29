/**
 * An approval answered in place under its row (Paper H4): Approve / Always here / Deny for a
 * command, file change or tool; choice chips and Reply… for a question.
 */
import type { ApprovalRequest } from "@polaris/protocol";
import { midnight, mobileType } from "@polaris/ui/tokens";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { approvalDetail, askLine, quickQuestion } from "../model/lines.ts";
import { haptics } from "../../motion/index.ts";
import type { Reply } from "../model/respond.ts";

export interface ApprovalActionsProps {
  readonly approval: ApprovalRequest;
  /** False while the Host isn't connected: shown, not answerable. */
  readonly enabled: boolean;
  readonly onReply: (reply: Reply) => Promise<void>;
  /** A question this row can't answer inline (several questions): open the agent session. */
  readonly onOpen: () => void;
}

type Sending =
  | { readonly kind: "idle" }
  | { readonly kind: "sending" }
  | { readonly kind: "failed" };

const useSend = (onReply: ApprovalActionsProps["onReply"]) => {
  const [sending, setSending] = useState<Sending>({ kind: "idle" });

  const send = (reply: Reply) => {
    if (reply.kind !== "deny") haptics.approve();
    setSending({ kind: "sending" });
    onReply(reply).then(
      () => setSending({ kind: "idle" }),
      () => setSending({ kind: "failed" })
    );
  };

  return { sending, send };
};

const Ask = ({ approval }: { readonly approval: ApprovalRequest }) => {
  const detail = approvalDetail(approval);

  return (
    <>
      <Text style={styles.ask}>{askLine(approval)}</Text>
      {detail === null ? null : (
        <Text style={styles.command} numberOfLines={detail.tooLong ? 4 : undefined}>
          {detail.text}
        </Text>
      )}
    </>
  );
};

const Permission = ({ approval, enabled, onReply, onOpen }: ApprovalActionsProps) => {
  const { sending, send } = useSend(onReply);
  const live = enabled && sending.kind !== "sending";

  if (approvalDetail(approval)?.tooLong === true)
    return (
      <View style={styles.block}>
        <Ask approval={approval} />
        <Pressable accessibilityRole="button" onPress={onOpen} style={styles.reviewWhole}>
          <Text style={styles.always}>Review it in the agent session</Text>
        </Pressable>
      </View>
    );

  return (
    <View style={styles.block}>
      <Ask approval={approval} />
      <View style={[styles.buttons, live ? null : styles.waiting]}>
        <Pressable
          accessibilityRole="button"
          disabled={!live}
          onPress={() => send({ kind: "approve" })}
          style={({ pressed }) => [styles.approve, pressed ? styles.pressed : null]}
        >
          <Text style={styles.approveLabel}>Approve</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!live}
          onPress={() => send({ kind: "always" })}
          hitSlop={10}
        >
          <Text style={styles.always}>Always here</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!live}
          onPress={() => send({ kind: "deny" })}
          hitSlop={10}
        >
          <Text style={styles.deny}>Deny</Text>
        </Pressable>
      </View>
      {sending.kind === "failed" ? (
        <Text style={styles.failed}>Couldn't send. Try again.</Text>
      ) : null}
    </View>
  );
};

const ReplyField = ({
  onSend,
  onCancel,
}: {
  readonly onSend: (text: string) => void;
  readonly onCancel: () => void;
}) => {
  const [text, setText] = useState("");

  return (
    <TextInput
      autoFocus
      style={styles.reply}
      value={text}
      onChangeText={setText}
      placeholder="Reply…"
      placeholderTextColor={midnight.textFaint}
      returnKeyType="send"
      onSubmitEditing={() => (text.trim() === "" ? onCancel() : onSend(text.trim()))}
      onBlur={() => {
        if (text.trim() === "") onCancel();
      }}
    />
  );
};

const Question = ({ approval, enabled, onReply, onOpen }: ApprovalActionsProps) => {
  const { sending, send } = useSend(onReply);
  const [replying, setReplying] = useState(false);
  const quick = quickQuestion(approval);
  const live = enabled && sending.kind !== "sending";

  return (
    <View style={styles.block}>
      <Text style={styles.question}>
        <Text style={styles.askInline}>Asks · </Text>
        {quick?.text ?? approval.title}
      </Text>
      {replying ? (
        <ReplyField
          onCancel={() => setReplying(false)}
          onSend={(text) => {
            setReplying(false);
            send({ kind: "answer", text });
          }}
        />
      ) : (
        <View style={[styles.chips, live ? null : styles.waiting]}>
          {(quick?.choices ?? []).map((choice, index) => (
            <Pressable
              key={choice}
              accessibilityRole="button"
              disabled={!live}
              onPress={() => send({ kind: "answer", text: choice })}
              style={index === 0 ? styles.firstChoice : styles.choice}
            >
              <Text
                style={index === 0 ? styles.firstChoiceLabel : styles.choiceLabel}
                numberOfLines={1}
              >
                {choice}
              </Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            disabled={!live}
            onPress={() => (quick === null ? onOpen() : setReplying(true))}
            hitSlop={10}
            style={styles.replyLink}
          >
            <Text style={styles.replyLabel}>{quick === null ? "Answer…" : "Reply…"}</Text>
          </Pressable>
        </View>
      )}
      {sending.kind === "failed" ? (
        <Text style={styles.failed}>Couldn't send. Try again.</Text>
      ) : null}
    </View>
  );
};

export const ApprovalActions = (props: ApprovalActionsProps) =>
  props.approval.kind === "question" ? <Question {...props} /> : <Permission {...props} />;

const styles = StyleSheet.create({
  block: { gap: 8, paddingLeft: 72 },
  ask: { ...mobileType.subhead, color: midnight.needsYouText },
  command: { ...mobileType.command, color: midnight.textDefault },
  buttons: { flexDirection: "row", alignItems: "center", gap: 18, paddingTop: 2 },
  waiting: { opacity: 0.55 },
  approve: {
    height: 36,
    paddingHorizontal: 20,
    borderRadius: 999,
    backgroundColor: midnight.textStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.8 },
  approveLabel: { ...mobileType.label, color: midnight.bg },
  always: { ...mobileType.label, color: midnight.textDefault },
  deny: { ...mobileType.label, color: midnight.textSubtle },
  question: { ...mobileType.callout, color: midnight.textDefault },
  askInline: { color: midnight.needsYouText },
  chips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  firstChoice: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: midnight.textStrong,
    justifyContent: "center",
    maxWidth: "100%",
  },
  firstChoiceLabel: { ...mobileType.subhead, fontWeight: "500", color: midnight.bg },
  choice: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#ffffff1f",
    justifyContent: "center",
    maxWidth: "100%",
  },
  choiceLabel: { ...mobileType.subhead, fontWeight: "500", color: midnight.textDefault },
  replyLink: { paddingLeft: 6 },
  reviewWhole: { paddingTop: 2 },
  replyLabel: { ...mobileType.subhead, fontWeight: "500", color: midnight.textSubtle },
  reply: {
    ...mobileType.callout,
    color: midnight.textStrong,
    borderWidth: 1,
    borderColor: "#ffffff1f",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  failed: { ...mobileType.footnote, color: midnight.failedText },
});
