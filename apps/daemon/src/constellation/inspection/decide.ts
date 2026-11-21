/**
 * The Inspection steps of the graph decider (ADR 0119): an Inspection is a step on a Claim's
 * review, started with the Claim and ended by a verdict, a newer Claim or a review.
 */
import {
  type Attempt,
  AttemptCause,
  type CheckReceipt,
  ConstellationEvent,
  inspecting,
  NotificationItem,
  SessionId,
} from "@polaris/protocol";
import type { GraphCommand, RecordedCheck } from "../../engine/constellation.inputs.ts";
import { currentAttempt, evidence, startAttempt } from "../attempts.ts";
import type { GraphDecision } from "../decision.ts";

const refreshed = (d: GraphDecision, attempt: Attempt) =>
  d.record.graph.attempts.find((a) => a.id === attempt.id) ?? attempt;

const fields = (d: GraphDecision, attempt: Attempt) => ({
  ...d.fields(),
  attemptId: attempt.id,
  attemptRevision: attempt.revision + 1,
});

/** End a pending Inspection with no verdict; returns the Attempt as it now stands. */
export const endInspection = (
  d: GraphDecision,
  attempt: Attempt,
  cause: "claim" | "review" | "lost",
  reason: string
): Attempt => {
  if (attempt.inspection?.state !== "pending") return attempt;

  d.emit(
    ConstellationEvent.cases.InspectionEnded.make({
      ...fields(d, attempt),
      inspectionId: attempt.inspection.id,
      cause,
      reason,
      at: d.ctx.now,
    })
  );

  return refreshed(d, attempt);
};

/**
 * After a Claim commits: start the Inspection its Task is marked for and hold the Claim, or
 * tell the Lead of the Claim at once. `before` is the Attempt as the Claim found it.
 */
export const claimed = (d: GraphDecision, before: Attempt) => {
  const attempt = endInspection(
    d,
    refreshed(d, before),
    "claim",
    "A newer Claim replaced the one it read"
  );

  const task = d.record.graph.tasks.find((t) => t.id === attempt.taskId);

  if (task?.inspect == null || task.kind === "gate" || attempt.claim === null) {
    d.notify(NotificationItem.cases.Settled.make({ attemptId: attempt.id, state: "review" }));

    return;
  }

  const base = fields(d, attempt);
  const inspectionId = `${base.constellationId}:${base.revision}:inspection`;

  d.emit(
    ConstellationEvent.cases.InspectionStarted.make({
      ...base,
      inspectionId,
      sessionId: SessionId.make(`${inspectionId}:inspector`),
      head: attempt.claim.head,
      accept: task.inspect.accept === true,
      at: d.ctx.now,
    })
  );
};

/** The Attempt and pending Inspection a verdict names, when the binding is its Inspector. */
const inspected = (d: GraphDecision, command: GraphCommand<"Inspect">) => {
  const stale = () =>
    d.reject(
      "E-INSPECTION-STALE",
      "This Inspection is over: a newer Claim or a review replaced it",
      "Stop here; no verdict is needed."
    );

  const attempt = d.record.graph.attempts.find((a) => a.id === command.attemptId);
  const inspection = attempt?.inspection;

  if (
    d.ctx.binding.kind !== "session" ||
    inspection == null ||
    d.ctx.binding.sessionId !== inspection.sessionId ||
    inspection.id !== command.inspectionId
  ) {
    d.reject(
      "E-AUTHORITY",
      "Only the Inspection's own Inspector records its verdict",
      "Use the Inspector's bound verdict tool."
    );

    return undefined;
  }

  if (attempt === undefined || !inspecting(attempt) || attempt.claim?.head !== inspection.head) {
    stale();

    return undefined;
  }

  const current = currentAttempt(d, attempt.id, undefined, "E-INSPECTION-STALE");

  return current === undefined ? undefined : { attempt: current, inspection };
};

const record = (
  d: GraphDecision,
  attempt: Attempt,
  command: GraphCommand<"Inspect">,
  route: "lead" | "accepted" | "sent_back",
  mergeRefusal: string | null = null
) => {
  d.emit(
    ConstellationEvent.cases.InspectionRecorded.make({
      ...fields(d, attempt),
      inspectionId: command.inspectionId,
      verdict: command.verdict,
      route,
      reason: command.reason,
      mergeRefusal,
      at: d.ctx.now,
    })
  );

  return refreshed(d, attempt);
};

const sendBack = (d: GraphDecision, attempt: Attempt, command: GraphCommand<"Inspect">) => {
  if (command.reason.trim() === "") {
    d.reject(
      "E-INSPECTION-REASON",
      "A send-back needs a reason",
      "Say what the worker must change; the next Attempt's brief carries it."
    );

    return;
  }

  const recorded = record(d, attempt, command, "sent_back");

  d.emit(
    ConstellationEvent.cases.AttemptRejected.make({
      ...fields(d, recorded),
      reason: command.reason,
      by: "inspector",
      actor: null,
    })
  );
  startAttempt(d, attempt.taskId, AttemptCause.cases.SentBack.make({ ref: attempt.id }));

  if (d.findings.length === 0)
    d.notify(NotificationItem.cases.Settled.make({ attemptId: attempt.id, state: "rejected" }));
};

/** A Claim's receipts against what this Host recorded: its evidence tier, or why they fail. */
const weigh = (
  recordedChecks: ReadonlyArray<RecordedCheck>,
  receipts: ReadonlyArray<CheckReceipt>
) => {
  const scratch: Array<string> = [];

  const tier = evidence(
    { ctx: { recordedChecks }, reject: (_code, message) => void scratch.push(message) },
    receipts
  );

  return scratch.length > 0 ? ({ refusal: scratch.join("; ") } as const) : ({ tier } as const);
};

/** Why a Claim's receipts would refuse an Accept, or null; a verdict checks before it merges. */
export const unevidenced = (
  recordedChecks: ReadonlyArray<RecordedCheck>,
  receipts: ReadonlyArray<CheckReceipt>
) => {
  const weighed = weigh(recordedChecks, receipts);

  return "refusal" in weighed ? weighed.refusal : null;
};

/** A granted Accept that merged and whose receipts resolve; anything else goes to the Lead. */
const grantedAccept = (d: GraphDecision, attempt: Attempt) => {
  const merge = d.ctx.inspectorMerge;

  if (merge === undefined || merge === null)
    return { refusal: "Polaris did not merge it" } as const;

  if (merge.refusal !== null) return { refusal: merge.refusal } as const;

  return weigh(d.ctx.recordedChecks, attempt.claim?.receipts ?? []);
};

/** An Inspector's verdict: recorded, then routed to the Lead, to Accept or to a SendBack. */
export const inspect = (d: GraphDecision, command: GraphCommand<"Inspect">) => {
  const found = inspected(d, command);

  if (found === undefined) return;
  const { attempt, inspection } = found;

  if (command.verdict === "send_back") {
    sendBack(d, attempt, command);

    return;
  }

  const granted = inspection.accept ? grantedAccept(d, attempt) : null;

  if (granted === null || "refusal" in granted) {
    record(d, attempt, command, "lead", granted?.refusal ?? null);
    d.notify(NotificationItem.cases.Settled.make({ attemptId: attempt.id, state: "review" }));

    return;
  }

  const recorded = record(d, attempt, command, "accepted");

  d.emit(
    ConstellationEvent.cases.AttemptAccepted.make({
      ...fields(d, recorded),
      mergedHead: inspection.head,
      receipts: [...(attempt.claim?.receipts ?? [])],
      evidence: granted.tier,
      findings: d.ctx.mergeFindings ?? [],
    })
  );
  d.notify(NotificationItem.cases.Settled.make({ attemptId: attempt.id, state: "accepted" }));
};
