import {
  Attempt,
  AttemptCause,
  CheckReceipt,
  ConstellationEvent,
  NotificationItem,
  type TaskId,
} from "@polaris/protocol";
import { Option, Predicate, Schema } from "effect";
import type { GraphCommand } from "../engine/constellation.inputs.ts";
import { questionKey } from "../store/constellation.ts";
import { attemptData } from "./data.ts";
import { GraphDecision } from "./decision.ts";
import { effectiveDeps, isParent } from "./parents.ts";
import { accepted, activeAttempt, latestAttempt, projectTask } from "./projections.ts";

export const currentAttempt = (
  d: GraphDecision,
  id: Attempt["id"],
  revision?: number,
  stateCode = "E-SETTLED"
) => {
  const attempt = d.record.graph.attempts.find((a) => a.id === id);

  if (attempt === undefined)
    d.reject(
      "E-ATTEMPT-UNKNOWN",
      `Attempt ${id} does not exist`,
      "Read status for the current Attempt ids."
    );
  else if (latestAttempt(d.record.graph, attempt.taskId)?.id !== id || !activeAttempt(attempt))
    d.reject(
      stateCode,
      `Attempt ${id} is ${attempt.state} and is not mutable`,
      "Act on the latest active Attempt shown in status."
    );
  else if (revision !== undefined && revision !== attempt.revision)
    d.reject(
      "E-REVISION",
      `Attempt ${id} is at revision ${attempt.revision}`,
      "Read status and retry with the current Attempt revision."
    );
  else return attempt;

  return undefined;
};

const validateDraft = (d: GraphDecision, draft: Attempt) => {
  const previous = latestAttempt(d.record.graph, draft.taskId);

  if (
    d.record.graph.attempts.some((a) => a.id === draft.id) ||
    d.record.graph.tasks.some((t) => String(t.id) === String(draft.id))
  )
    d.reject(
      "E-ATTEMPT-ID",
      `Attempt id ${draft.id} already exists`,
      "Allocate a fresh Attempt id."
    );

  if (
    draft.state !== "working" ||
    draft.revision !== 0 ||
    draft.claim !== null ||
    draft.endedAt !== null ||
    draft.mergedHead !== null ||
    draft.evidence !== null ||
    draft.receipts.length > 0 ||
    draft.approvedByUserAt !== null ||
    draft.handedUpAt !== null ||
    draft.handedUpReason !== null ||
    draft.nudgedAt !== null ||
    draft.blockedOn.length > 0 ||
    draft.blockedReason !== null ||
    draft.blockedAt !== null
  )
    d.reject(
      "E-ATTEMPT-DRAFT",
      `Attempt ${draft.id} must start working without an outcome`,
      "Prepare a fresh Attempt at revision zero."
    );

  if (
    d.record.graph.attempts.some((a) => a.sessionId === draft.sessionId && activeAttempt(a)) ||
    d.ctx.occupiedSessions.has(draft.sessionId)
  )
    d.reject(
      "E-SESSION-ACTIVE",
      `Session ${draft.sessionId} already carries an active Attempt`,
      "Use an idle session without an active Attempt."
    );

  if (
    previous === undefined
      ? !Predicate.isTagged(draft.cause, "Initial")
      : !("ref" in draft.cause) || draft.cause.ref !== previous.id
  )
    d.reject(
      "E-CAUSE",
      `Attempt ${draft.id} must reference the previous Attempt on its Task`,
      "Use Initial only for the first Attempt and link subsequent causes backward."
    );
};

export const startAttempt = (d: GraphDecision, taskId: TaskId, cause?: Attempt["cause"]) => {
  const prepared = d.ctx.attempts.find((a) => a.taskId === taskId);

  if (prepared === undefined) {
    d.reject(
      "E-PLACEMENT",
      `Task ${taskId} has no prepared worker`,
      "Prepare a worker placement before dispatch."
    );

    return;
  }

  const previous = latestAttempt(d.record.graph, taskId);

  const superseded =
    previous !== undefined && d.record.handoverStopped.has(previous.id)
      ? AttemptCause.cases.Superseded.make({ ref: previous.id })
      : prepared.cause;

  const draft = new Attempt({
    ...attemptData(prepared),
    cause: cause ?? superseded,
    startedAt: d.ctx.now,
  });

  const task = d.record.graph.tasks.find((t) => t.id === taskId);

  if (task?.kind === "gate" && draft.sessionId !== d.record.graph.leadSessionId)
    d.reject(
      "E-GATE-WORKER",
      `Gate ${taskId} must use the Lead's session`,
      "Place the Gate Attempt on the current Lead."
    );
  validateDraft(d, draft);

  if (d.findings.length === 0)
    d.emit(ConstellationEvent.cases.AttemptStarted.make({ ...d.fields(), attempt: draft }));
};

export const dispatch = (d: GraphDecision, command: GraphCommand<"Dispatch">) => {
  const ids =
    command.tasks.length > 0
      ? command.tasks.map((t) => t.taskId)
      : d.record.graph.tasks
          .filter(
            (task) =>
              !isParent(d.record.graph, task.id) && projectTask(d.record, task).state === "ready"
          )
          .map((t) => t.id);

  const seen = new Set<TaskId>();

  for (const id of ids) {
    const task = d.record.graph.tasks.find((t) => t.id === id);

    if (seen.has(id))
      d.reject("E-DISPATCH-DUPLICATE", `Task ${id} is dispatched twice`, "Name each Task once.");
    seen.add(id);

    if (task === undefined)
      d.reject(
        "E-TASK-UNKNOWN",
        `Task ${id} does not exist`,
        "Read status for the current Task ids."
      );
    else if (isParent(d.record.graph, id))
      d.reject(
        "E-PARENT-DISPATCH",
        `Task ${id} is a parent container`,
        "Dispatch its ready children instead."
      );
    else if (
      projectTask(d.record, task).state !== "ready" &&
      !(
        command.tasks.length > 0 &&
        !task.canceled &&
        effectiveDeps(d.record.graph.tasks, task.id).every((dep) =>
          accepted(d.record.graph, dep)
        ) &&
        ["lost", "failed", "settled_unverified"].includes(
          latestAttempt(d.record.graph, id)?.state ?? ""
        )
      )
    )
      d.reject(
        "E-NOT-READY",
        `Task ${id} is not ready`,
        "Accept its dependencies and settle its active Attempt first."
      );

    if (d.findings.length === 0) startAttempt(d, id);
  }
};

const CheckedOutput = Schema.Struct({
  command: Schema.NonEmptyString,
  exitCode: Schema.Int,
  output: Schema.String,
});

const decodeOutput = Schema.decodeUnknownOption(CheckedOutput);

/** Resolve every verified receipt against Daemon-recorded output; a forged reference rejects acceptance. */
export const evidence = (d: GraphDecision, receipts: ReadonlyArray<CheckReceipt>) => {
  let verified = false;

  for (const receipt of receipts)
    CheckReceipt.match(receipt, {
      Reported: () => {},
      Verified: ({ item: ref }) => {
        const item = d.ctx.recordedChecks.find(
          (check) =>
            check.reference.hostId === ref.hostId &&
            check.reference.sessionId === ref.sessionId &&
            check.reference.turnId === ref.turnId &&
            check.reference.itemId === ref.itemId
        )?.item;

        const command =
          Predicate.isTagged(item, "CommandExecution") &&
          item.status === "completed" &&
          item.command !== "" &&
          item.exitCode !== null
            ? Option.some({ command: item.command, exitCode: item.exitCode, output: item.output })
            : Predicate.isTagged(item, "ToolCall") && item.status === "completed"
              ? decodeOutput(item.output)
              : Option.none();

        if (Option.isNone(command))
          d.reject(
            "E-RECEIPT-UNKNOWN",
            `Receipt ${ref.itemId} is not a recorded completed command with output and exit code`,
            "Reference a Daemon-recorded command item, or use a reported receipt."
          );
        else if (command.value.exitCode !== 0)
          d.reject(
            "E-RECEIPT-FAILED",
            `Receipt ${ref.itemId} exited ${command.value.exitCode}`,
            "Run the check successfully and reference its completed item."
          );
        else verified = true;
      },
    });

  if (verified) return "verified" as const;

  return receipts.length > 0 ? ("reported" as const) : ("asserted" as const);
};

const reviewMetadata = (
  d: GraphDecision,
  command: GraphCommand<"Review">,
  attempt: Attempt
): boolean => {
  const fields = () => ({
    ...d.fields(),
    attemptId: attempt.id,
    attemptRevision: attempt.revision + 1,
  });

  if (Predicate.isTagged(command.action, "Approve")) {
    if (d.ctx.binding.kind !== "user")
      d.reject(
        "E-AUTHORITY",
        "Only the user can approve a Claim",
        "Ask the user to approve in Review."
      );
    else if (attempt.approvedByUserAt === null)
      d.emit(
        ConstellationEvent.cases.ClaimApproved.make({ ...fields(), by: "user", at: d.ctx.now })
      );

    return true;
  }

  if (Predicate.isTagged(command.action, "HandUp")) {
    if (
      d.ctx.binding.kind !== "session" ||
      d.ctx.binding.sessionId !== d.record.graph.leadSessionId
    )
      d.reject("E-AUTHORITY", "Only the current Lead can hand up a Claim", "Use the Lead binding.");
    else if (attempt.handedUpAt === null)
      d.emit(
        ConstellationEvent.cases.ClaimHandedUp.make({
          ...fields(),
          reason: command.action.reason,
          at: d.ctx.now,
        })
      );

    return true;
  }

  return false;
};

export const review = (d: GraphDecision, command: GraphCommand<"Review">) => {
  const attempt = currentAttempt(d, command.attemptId, command.revision);

  if (attempt === undefined) return;

  const fields = () => ({
    ...d.fields(),
    attemptId: attempt.id,
    attemptRevision: attempt.revision + 1,
  });

  if (Predicate.isTagged(command.action, "Stop")) {
    d.emit(
      ConstellationEvent.cases.AttemptSettled.make({
        ...fields(),
        outcome: "lost",
        reason: command.action.reason,
      })
    );
    d.notify(NotificationItem.cases.Settled.make({ attemptId: attempt.id, state: "lost" }));

    return;
  }

  if (
    !(attempt.state === "blocked" && Predicate.isTagged(command.action, "SendBack")) &&
    (attempt.state !== "review" || attempt.claim === null)
  ) {
    d.reject(
      "E-REVIEW",
      `Attempt ${attempt.id} has no Claim to review`,
      "Wait for a Claim or stop the Attempt."
    );

    return;
  }

  if (reviewMetadata(d, command, attempt)) return;

  if (Predicate.isTagged(command.action, "Accept")) {
    if (command.action.mergedHead !== attempt.claim?.head)
      d.reject(
        "E-MERGED-HEAD",
        `Merged head ${command.action.mergedHead} differs from claimed head ${attempt.claim?.head}`,
        "Merge the claimed head and accept that exact head."
      );
    const receipts = [...(attempt.claim?.receipts ?? []), ...command.action.receipts];
    const tier = evidence(d, receipts);

    if (d.findings.length > 0) return;
    d.emit(
      ConstellationEvent.cases.AttemptAccepted.make({
        ...fields(),
        mergedHead: command.action.mergedHead,
        receipts,
        evidence: tier,
      })
    );
    d.notify(NotificationItem.cases.Settled.make({ attemptId: attempt.id, state: "accepted" }));

    return;
  }

  if (!Predicate.isTagged(command.action, "SendBack")) return;

  d.emit(
    ConstellationEvent.cases.AttemptRejected.make({ ...fields(), reason: command.action.reason })
  );

  const cause =
    command.action.mergeConflictBase === null
      ? AttemptCause.cases.SentBack.make({ ref: attempt.id })
      : AttemptCause.cases.MergeConflict.make({
          ref: attempt.id,
          base: command.action.mergeConflictBase,
        });

  startAttempt(d, attempt.taskId, cause);

  if (d.findings.length === 0)
    d.notify(NotificationItem.cases.Settled.make({ attemptId: attempt.id, state: "rejected" }));
};

const validateClaimHead = (
  d: GraphDecision,
  command: GraphCommand<"WorkerClaim">,
  attempt: Attempt
) => {
  const probe = d.ctx.claimProbe;

  if (probe === null)
    d.reject(
      "E-CLAIM-PROBE",
      "The worker's git state has not been checked",
      "Validate the worktree on the worker's Host before claiming."
    );
  else {
    if (probe.dirtyPaths.length > 0)
      d.reject(
        "E-CLAIM-DIRTY",
        `Uncommitted paths: ${probe.dirtyPaths.join(", ")}`,
        "Commit or remove the uncommitted changes and claim again."
      );

    if (
      command.claim.branch !== attempt.branch ||
      probe.branch !== attempt.branch ||
      probe.head !== command.claim.head
    )
      d.reject(
        "E-CLAIM-HEAD",
        "The Claim does not match the Attempt branch and its current head",
        `Claim the committed head on ${attempt.branch}.`
      );
  }
};

export const claim = (d: GraphDecision, command: GraphCommand<"WorkerClaim">, attempt: Attempt) => {
  validateClaimHead(d, command, attempt);

  if (attempt.state !== "working" && attempt.state !== "review")
    d.reject(
      "E-CLAIM-STATE",
      `Attempt ${attempt.id} is ${attempt.state}`,
      attempt.state === "blocked"
        ? "Wait for its dependencies or a Lead message to resume the Attempt."
        : "Review its existing Claim."
    );

  if (attempt.state === "review" && command.claim.head === attempt.claim?.head)
    d.reject(
      "E-CLAIM-UNCHANGED",
      "The current branch head is already in review",
      "Commit the additional work before claiming again, or review the existing Claim."
    );

  const questions = new Set<string>();

  for (const question of command.claim.questions) {
    if (questions.has(question.id) || d.record.questions.has(questionKey(attempt.id, question.id)))
      d.reject(
        "E-QUESTION-EXISTS",
        `Question ${question.id} already exists`,
        "Use a fresh question id."
      );
    questions.add(question.id);
  }

  if (d.findings.length > 0) return;
  d.emit(
    ConstellationEvent.cases.AttemptClaimed.make({
      ...d.fields(),
      attemptId: attempt.id,
      attemptRevision: attempt.revision + 1,
      claim: command.claim,
    })
  );
  d.notify(NotificationItem.cases.Settled.make({ attemptId: attempt.id, state: "review" }));

  for (const question of command.claim.questions)
    d.notify(NotificationItem.cases.Question.make({ attemptId: attempt.id, question }));
};
