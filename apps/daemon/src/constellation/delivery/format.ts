import type { ConstellationEvent, ConstellationNotification, StallAudit } from "@polaris/protocol";
import { Match, Predicate } from "effect";
import type { ConstellationRecord } from "../../store/constellation.ts";
import { capacityBlocked, failureKindLabel } from "../failureKind.ts";
import { auditLines, dueAudit } from "../stall.ts";
import { proposalDetails } from "../status.ts";

const line = (text: string) => text.replace(/\s+/g, " ").trim();

const settledLine = (
  record: ConstellationRecord,
  task: string,
  i: Extract<ConstellationNotification["item"], { _tag: "Settled" }>
) => {
  const reason = line(record.graph.attempts.find((a) => a.id === i.attemptId)?.settleReason ?? "");

  if (i.state === "failed" && i.failureKind === "capacity")
    return `${task}: ${capacityBlocked(i.resetsAt)}: ${reason}. Polaris will not redispatch it; dispatch it again after the reset or on another Model.`;

  if (i.state === "failed" && i.failureKind !== null)
    return `${task}: failed (${failureKindLabel(i.failureKind)}): ${reason}`.trim();

  return `${task}: ${i.state === "rejected" ? "sent back" : i.state}.`;
};

export const notificationLine = (record: ConstellationRecord, n: ConstellationNotification) => {
  const worker = (id: string) => record.graph.attempts.find((a) => a.id === id)?.taskId ?? id;

  return Match.value(n.item).pipe(
    Match.tag(
      "Blocked",
      (i) =>
        `${i.taskId}: blocked${i.on.length === 0 ? " awaiting the Lead" : ` by ${i.on.join(", ")}`}: ${line(i.reason)}`
    ),
    Match.tag("Stopped", (i) => `${i.taskId} stopped without claiming.`),
    Match.tag("Settled", (i) => settledLine(record, worker(i.attemptId), i)),
    Match.tag("Approved", (i) => {
      const attempt = record.graph.attempts.find((a) => a.id === i.attemptId);

      if (attempt?.approvedByUserAt == null || attempt.claim === null)
        return `${worker(i.attemptId)}: approved by the user, then claimed again; review the new claim.`;

      return `${worker(i.attemptId)}: approved by the user. Merge ${attempt.branch} at ${attempt.claim.head} into your branch, then accept it.`;
    }),
    Match.tag(
      "Question",
      (i) => `${worker(i.attemptId)} asks ${i.question.to}: ${line(i.question.text)}`
    ),
    Match.tag("Proposal", (i) => {
      const task = record.proposals.get(i.proposalId)?.task;

      return task === undefined
        ? `${worker(i.attemptId)} proposed ${i.proposalId}; it has been resolved.`
        : [
            `${worker(i.attemptId)} proposes ${task.id} · ${task.title} (${i.proposalId}).`,
            ...proposalDetails(task),
          ].join("\n");
    }),
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
    Match.tag("Settled", "Approved", "Proposal", "Blocked", "Stopped", () => true),
    Match.tag("Question", (i) => i.question.to === "lead"),
    Match.tag("QuestionAnswered", () => true),
    Match.tag("OperatorMessage", () => false),
    Match.exhaustive
  );

export const digestDelay = (
  record: ConstellationRecord,
  sessions?: ReadonlyMap<
    ConstellationRecord["graph"]["leadSessionId"],
    import("../../store/model.ts").SessionRecord
  >
): number | null => {
  const pending = record.graph.pendingNotifications;

  // A stall audit is Lead-worthy on its own and shares the Claim window; no extra timer.
  if (!pending.some(wakesLead) && (sessions === undefined || dueAudit(record, sessions) === null))
    return null;

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

const digestBody = (
  record: ConstellationRecord,
  items: ReadonlyArray<ConstellationNotification>,
  audit: StallAudit | null
) => [
  `Polaris · ${record.graph.name} · revision ${record.graph.revision}`,
  ...items.map((n) => notificationLine(record, n)),
  ...(audit === null ? [] : auditLines(audit)),
  "Next: review Claims, answer open questions, then dispatch ready Tasks. Use status for details.",
];

export const digestPrompt = (record: ConstellationRecord, audit: StallAudit | null = null) =>
  digestBody(record, record.graph.pendingNotifications, audit).join("\n");

/** The same digest, worded for a Lead that hears it mid-Turn. */
export const steeredDigestPrompt = (
  record: ConstellationRecord,
  notified: Extract<ConstellationEvent, { _tag: "LeadNotified" }>
) =>
  [
    "This update arrived during your Turn. Fold it into your current work; it is not a new request.",
    ...digestBody(
      record,
      notified.items.flatMap((id) => {
        const n = record.notifications.get(id);

        return n === undefined ? [] : [n];
      }),
      notified.audit
    ),
  ].join("\n");
