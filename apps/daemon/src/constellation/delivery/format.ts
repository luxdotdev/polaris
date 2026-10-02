import type { ConstellationNotification } from "@polaris/protocol";
import { Match, Predicate } from "effect";
import type { ConstellationRecord } from "../../store/constellation.ts";

const line = (text: string) => text.replace(/\s+/g, " ").trim();

export const notificationLine = (record: ConstellationRecord, n: ConstellationNotification) => {
  const worker = (id: string) => record.graph.attempts.find((a) => a.id === id)?.taskId ?? id;

  return Match.value(n.item).pipe(
    Match.tag("Settled", (i) => `${worker(i.attemptId)}: ${i.state}.`),
    Match.tag(
      "Question",
      (i) => `${worker(i.attemptId)} asks ${i.question.to}: ${line(i.question.text)}`
    ),
    Match.tag(
      "Proposal",
      (i) =>
        `${worker(i.attemptId)} proposes ${record.proposals.get(i.proposalId)?.task.title ?? i.proposalId}.`
    ),
    Match.tag("OperatorMessage", (i) => {
      const message = record.sentMessages.get(i.messageId);

      const target =
        message !== undefined && "attemptId" in message.target
          ? worker(message.target.attemptId)
          : "the workers";

      return `You told ${target}: ${line(i.text)}`;
    }),
    Match.tag(
      "QuestionAnswered",
      (i) => `${worker(i.attemptId)} received an answer to ${i.questionId}: ${line(i.text)}`
    ),
    Match.exhaustive
  );
};

/** User questions and incidental steering remain queued until a Lead-worthy item arrives. */
export const wakesLead = (n: ConstellationNotification) =>
  Match.value(n.item).pipe(
    Match.tag("Settled", "Proposal", () => true),
    Match.tag("Question", (i) => i.question.to === "lead"),
    Match.tag("QuestionAnswered", () => true),
    Match.tag("OperatorMessage", () => false),
    Match.exhaustive
  );

export const digestDelay = (record: ConstellationRecord): number | null => {
  const pending = record.graph.pendingNotifications;

  if (!pending.some(wakesLead)) return null;

  const blocking = pending.some(
    (n) =>
      Predicate.isTagged(n.item, "Question") &&
      n.item.question.to === "lead" &&
      n.item.question.blocking
  );

  return blocking
    ? (record.graph.settings.questionCoalescingMs ?? 5000)
    : (record.graph.settings.claimCoalescingMs ?? 20000);
};

export const digestPrompt = (record: ConstellationRecord) =>
  [
    `Polaris · ${record.graph.name} · revision ${record.graph.revision}`,
    ...record.graph.pendingNotifications.map((n) => notificationLine(record, n)),
    "Next: review Claims, answer open questions, then dispatch ready Tasks. Use status for details.",
  ].join("\n");
