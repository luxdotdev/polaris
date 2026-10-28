/**
 * The session's pending requests above the composer: a permission with its
 * whole command and Approve / Always here / Deny, or every question with its
 * options and Send. Home sends long or many-question requests here.
 */
import type { ApprovalDecision, ApprovalRequest, RequestId } from "@polaris/protocol";
import { midnight, mobileType } from "@polaris/ui/tokens";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { decisionOf } from "../home/model/respond.ts";
import { answered, answersDecision, pick, type Picks, requestCard } from "./requests.ts";

export interface PendingRequestsProps {
  readonly requests: ReadonlyArray<ApprovalRequest>;
  readonly answering: ReadonlyArray<RequestId>;
  readonly errors: ReadonlyMap<RequestId, string>;
  /** False while the Host isn't connected: shown, not answerable. */
  readonly enabled: boolean;
  readonly onRespond: (requestId: RequestId, decision: ApprovalDecision) => void;
}

interface CardProps {
  readonly request: ApprovalRequest;
  readonly live: boolean;
  readonly onRespond: (decision: ApprovalDecision) => void;
}

const Permission = ({ request, live, onRespond }: CardProps) => {
  const card = requestCard(request);

  return (
    <>
      <Text style={styles.ask}>{card.kind === "permission" ? card.ask : request.title}</Text>
      {card.kind === "permission" && card.detail !== null ? (
        <Text style={styles.command} selectable>
          {card.detail}
        </Text>
      ) : null}
      <View style={[styles.buttons, live ? null : styles.waiting]}>
        <Pressable
          accessibilityRole="button"
          disabled={!live}
          onPress={() => onRespond(decisionOf({ kind: "approve" }))}
          style={styles.approve}
        >
          <Text style={styles.approveLabel}>Approve</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!live}
          onPress={() => onRespond(decisionOf({ kind: "always" }))}
          hitSlop={10}
        >
          <Text style={styles.always}>Always here</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!live}
          onPress={() => onRespond(decisionOf({ kind: "deny" }))}
          hitSlop={10}
        >
          <Text style={styles.deny}>Deny</Text>
        </Pressable>
      </View>
    </>
  );
};

const Questions = ({ request, live, onRespond }: CardProps) => {
  const [picks, setPicks] = useState<Picks>([]);
  const card = requestCard(request);
  const questions = card.kind === "questions" ? card.questions : [];
  const ready = live && answered(request, picks);

  return (
    <>
      {questions.map((question, index) => (
        <View key={`${index}:${question.question}`} style={styles.question}>
          <Text style={styles.questionText}>
            <Text style={styles.ask}>
              {question.header === "" ? "Asks · " : `${question.header} · `}
            </Text>
            {question.question}
          </Text>
          <View style={[styles.chips, live ? null : styles.waiting]}>
            {question.options.map((option) => {
              const chosen = (picks[index] ?? []).includes(option.label);

              return (
                <Pressable
                  key={option.label}
                  accessibilityRole="button"
                  accessibilityState={{ selected: chosen }}
                  disabled={!live}
                  onPress={() =>
                    setPicks((held) => pick(held, index, option.label, question.multiSelect))
                  }
                  style={chosen ? styles.chosen : styles.choice}
                >
                  <Text style={chosen ? styles.chosenLabel : styles.choiceLabel}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        disabled={!ready}
        onPress={() => onRespond(answersDecision(request, picks))}
        style={[styles.approve, ready ? null : styles.waiting]}
      >
        <Text style={styles.approveLabel}>Send answers</Text>
      </Pressable>
    </>
  );
};

export const PendingRequests = ({
  requests,
  answering,
  errors,
  enabled,
  onRespond,
}: PendingRequestsProps) =>
  requests.length === 0 ? null : (
    <View style={styles.list}>
      {requests.map((request) => {
        const props: CardProps = {
          request,
          live: enabled && !answering.includes(request.id),
          onRespond: (decision) => onRespond(request.id, decision),
        };

        const error = errors.get(request.id);

        return (
          <View key={request.id} style={styles.card}>
            {request.kind === "question" ? <Questions {...props} /> : <Permission {...props} />}
            {error === undefined ? null : (
              <Text style={styles.failed}>Couldn't send. Try again.</Text>
            )}
          </View>
        );
      })}
    </View>
  );

const styles = StyleSheet.create({
  list: { gap: 12, marginBottom: 8 },
  card: {
    gap: 8,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: midnight.needsYouText,
  },
  ask: { ...mobileType.subhead, color: midnight.needsYouText },
  command: { ...mobileType.command, color: midnight.textDefault },
  buttons: { flexDirection: "row", alignItems: "center", gap: 18, paddingTop: 2 },
  waiting: { opacity: 0.55 },
  approve: {
    alignSelf: "flex-start",
    height: 36,
    paddingHorizontal: 20,
    borderRadius: 999,
    backgroundColor: midnight.textStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  approveLabel: { ...mobileType.label, color: midnight.bg },
  always: { ...mobileType.label, color: midnight.textDefault },
  deny: { ...mobileType.label, color: midnight.textSubtle },
  question: { gap: 6 },
  questionText: { ...mobileType.callout, color: midnight.textDefault },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: {
    minHeight: 34,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: midnight.hairline,
    justifyContent: "center",
    maxWidth: "100%",
  },
  chosen: {
    minHeight: 34,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 17,
    backgroundColor: midnight.textStrong,
    justifyContent: "center",
    maxWidth: "100%",
  },
  choiceLabel: { ...mobileType.subhead, fontWeight: "500", color: midnight.textDefault },
  chosenLabel: { ...mobileType.subhead, fontWeight: "500", color: midnight.bg },
  failed: { ...mobileType.footnote, color: midnight.failedText },
});
