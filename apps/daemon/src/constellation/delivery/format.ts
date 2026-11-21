import type {
  Attempt,
  ConstellationEvent,
  ConstellationNotification,
  StallAudit,
} from "@polaris/protocol";
import { Match, Predicate } from "effect";
import type { ConstellationRecord } from "../../store/constellation.ts";
import { capacityBlocked, failureKindLabel } from "../failureKind.ts";
import type { SlotSource } from "../slots.ts";
import { auditLines, dueAudit, nextSlotStall } from "../stall.ts";
import { proposalDetails } from "../status.ts";
import { userName } from "../userName.ts";

const line = (text: string) => text.replace(/\s+/g, " ").trim();

const REASON_LIMIT = 240;

/** Who sent it back and why; the next Attempt's brief carries the reason in full. */
const sentBackLine = (task: string, attempt: Attempt | undefined) => {
  const by = Match.value(attempt?.rejectedBy).pipe(
    Match.when("user", () => ` by ${userName(attempt?.reviewedBy)}`),
    Match.when("inspector", () => " by its inspector; the next Attempt has started"),
    Match.orElse(() => "")
  );

  const reason = line(attempt?.rejectionReason ?? "");

  if (reason === "") return `${task}: sent back${by}.`;

  return `${task}: sent back${by}: ${reason.length > REASON_LIMIT ? `${reason.slice(0, REASON_LIMIT)}…` : reason}`;
};

/** What the Claim's Inspection found, said with the Claim it held back (ADR 0119). */
const inspectionNote = (attempt: Attempt | undefined, state: "review" | "accepted") => {
  const inspection = attempt?.inspection;
  const reason = line(inspection?.reason ?? "");
  const said = reason.length > REASON_LIMIT ? `${reason.slice(0, REASON_LIMIT)}…` : reason;

  if (inspection == null) return "";

  if (state === "accepted")
    return inspection.state === "accepted"
      ? ` Its inspector approved and Polaris merged it, as you granted: ${said}`
      : "";

  if (inspection.state === "lost")
    return ` Its inspector ended without a verdict (${said}); review the Claim yourself.`;

  if (inspection.state !== "approved") return "";

  return inspection.mergeRefusal == null
    ? ` Its inspector approved: ${said} You still accept it.`
    : ` Its inspector approved: ${said} Polaris could not merge it for you (${line(inspection.mergeRefusal)}); accept it or send it back.`;
};

const settledLine = (
  record: ConstellationRecord,
  task: string,
  i: Extract<ConstellationNotification["item"], { _tag: "Settled" }>
) => {
  const attempt = record.graph.attempts.find((a) => a.id === i.attemptId);
  const reason = line(attempt?.settleReason ?? "");

  if (i.state === "failed" && i.failureKind === "capacity")
    return `${task}: ${capacityBlocked(i.resetsAt)}: ${reason}. Polaris will not redispatch it; dispatch it again after the reset or on another Model.`;

  if (i.state === "failed" && i.failureKind !== null)
    return `${task}: failed (${failureKindLabel(i.failureKind)}): ${reason}`.trim();

  if (i.state === "rejected") return sentBackLine(task, attempt);

  if (i.state === "review" || i.state === "accepted")
    return `${task}: ${i.state}.${inspectionNote(attempt, i.state)}`;

  if (i.state === "lost" && attempt !== undefined && reason !== "") {
    const n = record.graph.attempts.filter((a) => a.taskId === attempt.taskId).indexOf(attempt) + 1;

    return `${task}: attempt ${n} lost (${reason}).`;
  }

  return `${task}: ${i.state}.`;
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

      return `${worker(i.attemptId)}: approved by ${userName(attempt.reviewedBy)}. Accept it with mergedHead ${attempt.claim.head}; Polaris merges ${attempt.branch} into your branch.`;
    }),
    Match.tag(
      "Question",
      (i) =>
        `${worker(i.attemptId)} asks ${i.question.to} (questionId ${line(i.question.id)}${i.question.blocking ? ", blocking" : ""}): ${line(i.question.text)}`
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

      const teller = userName(i.actor);

      return `${teller === "the user" ? "You" : teller} told ${target}: ${line(i.text)}`;
    }),
    Match.tag(
      "QuestionAnswered",
      (i) =>
        `${worker(i.attemptId)} received an answer${i.actor == null ? "" : ` from ${userName(i.actor)}`} to ${line(i.questionId)}: ${line(i.text)}`
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

/** A digest waits this long after the latest Lead-worthy item, so a burst arrives as one. */
export const DIGEST_DEBOUNCE_MS = 2000;

/** A steady stream still delivers this long after its first item. */
export const DIGEST_CEILING_MS = 20000;

/**
 * When a digest is due. `burst` names the newest Lead-worthy item: a new one restarts the
 * debounce, capped at the ceiling. A null `burst` is a fixed wake (a slot stall) in `debounceMs`.
 */
export interface DigestWindow {
  readonly burst: string | null;
  readonly debounceMs: number;
  readonly ceilingMs: number;
}

export const digestWindow = (
  record: ConstellationRecord,
  sessions?: ReadonlyMap<
    ConstellationRecord["graph"]["leadSessionId"],
    import("../../store/model.ts").SessionRecord
  >,
  host?: SlotSource
): DigestWindow | null => {
  const pending = record.graph.pendingNotifications;
  const newest = pending.findLast(wakesLead);

  // A stall audit is Lead-worthy on its own and shares the Claim window; no extra timer.
  if (
    newest === undefined &&
    (sessions === undefined || dueAudit(record, sessions, host) === null)
  ) {
    // A local slot holder with no first Turn wakes the runner once, when it would read stalled.
    const at =
      sessions === undefined || host === undefined ? null : nextSlotStall(record, sessions, host);

    if (at === null || host === undefined) return null;
    const delay = Math.max(0, at - host.now);

    return { burst: null, debounceMs: delay, ceilingMs: delay };
  }

  const blocking = pending.some(
    (n) =>
      Predicate.isTagged(n.item, "Question") &&
      n.item.question.to === "lead" &&
      n.item.question.blocking
  );

  const ceilingMs = record.graph.settings.claimCoalescingMs ?? DIGEST_CEILING_MS;

  return {
    burst: newest?.id ?? "audit",
    // A blocking question skips the debounce: its worker is waiting on the answer.
    debounceMs: blocking
      ? Math.min(record.graph.settings.questionCoalescingMs ?? 0, ceilingMs)
      : Math.min(DIGEST_DEBOUNCE_MS, ceilingMs),
    ceilingMs,
  };
};

const digestBody = (
  record: ConstellationRecord,
  items: ReadonlyArray<ConstellationNotification>,
  audit: StallAudit | null
) => [
  `Polaris · ${record.graph.name} · revision ${record.graph.revision}`,
  ...items.map((n) => notificationLine(record, n)),
  ...(audit === null ? [] : auditLines(audit, record)),
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
