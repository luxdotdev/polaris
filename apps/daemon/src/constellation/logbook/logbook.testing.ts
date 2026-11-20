/** A Constellation driven through the real decider, kept as the envelopes a store would hold. */
import {
  AnswerAction,
  AttemptCause,
  type ConstellationCommand,
  ConstellationQuestion,
  MessageTarget,
  PlanOperation,
  ReviewAction,
  Sequence,
  SessionId,
  TaskId,
  WorkerPlacement,
} from "@polaris/protocol";
import { decideConstellation } from "../../engine/constellation.ts";
import type { ConstellationContext } from "../../engine/constellation.inputs.ts";
import {
  A,
  B,
  C,
  CID,
  LEAD,
  ctx,
  draft,
  foldDecision,
  report,
  task,
  WS,
} from "../../engine/constellation.testing.ts";
import { type ConstellationRecord, graphEvent } from "../../store/constellation.ts";
import type { LogbookEvent } from "./fold.ts";

/** A Task that depends on A. */
export const D = TaskId.make("D");

export const WORKER = SessionId.make("worker");

export const RETRY = SessionId.make("retry");

export const PEER = SessionId.make("peer");

export const DEPENDENT = SessionId.make("dependent");

export const STRANGER = SessionId.make("stranger");

export const lead = { kind: "session" as const, sessionId: LEAD };

export const user = { kind: "user" as const };

export const as = (sessionId: SessionId) => ({ kind: "session" as const, sessionId });

/** The log so far and its fold; each command appends what the decider emits. */
export class Story {
  readonly envelopes: Array<LogbookEvent> = [];
  #record: ConstellationRecord | undefined = undefined;

  constructor() {
    this.run(
      C.Plan.make({
        constellationId: CID,
        start: { name: "Build", workspaceId: WS, leadSessionId: LEAD },
        operations: [task(A), task(B), task(D, [A])].map((t) =>
          PlanOperation.cases.Add.make({ task: t })
        ),
      }),
      ctx()
    );
  }

  get record(): ConstellationRecord {
    if (this.#record === undefined) throw new Error("the Constellation has not started");

    return this.#record;
  }

  /** The findings' codes when the decider refuses; the log is unchanged then. */
  attempt(command: ConstellationCommand, context: ConstellationContext) {
    const decision = decideConstellation(this.#record, command, context);

    if (decision.rejection !== null) return decision.rejection.findings.map((f) => f.code);

    for (const domain of decision.events) {
      const event = graphEvent(domain);

      if (event !== null) {
        const sequence = this.envelopes.length + 1;

        this.envelopes.push({
          sequence: Sequence.make(sequence),
          occurredAt: new Date(Date.UTC(2026, 9, 1, 0, 0, sequence)).toISOString(),
          event,
        });
      }
    }

    this.#record = foldDecision(this.#record, decision.events);

    return [];
  }

  run(command: ConstellationCommand, context: ConstellationContext) {
    const refused = this.attempt(command, context);

    if (refused.length > 0) throw new Error(`refused: ${refused.join(", ")}`);
  }

  latest(taskId: TaskId) {
    const attempt = this.record.graph.attempts.findLast((a) => a.taskId === taskId);

    if (attempt === undefined) throw new Error(`no Attempt on ${taskId}`);

    return attempt;
  }

  dispatch(taskId: TaskId, id: string, sessionId: SessionId) {
    const attempt = draft(taskId, id, sessionId);

    this.run(
      C.Dispatch.make({
        constellationId: CID,
        tasks: [{ taskId, worker: WorkerPlacement.cases.Existing.make({ sessionId }) }],
      }),
      ctx({ binding: lead, attempts: [attempt] })
    );
  }

  claim(taskId: TaskId, head: string) {
    const attempt = this.latest(taskId);
    const claim = report(attempt.branch, head);

    this.run(
      C.WorkerClaim.make({ constellationId: CID, attemptId: attempt.id, claim }),
      ctx({
        binding: as(attempt.sessionId),
        claimProbe: { dirtyPaths: [], branch: claim.branch, head: claim.head },
      })
    );
  }

  note(taskId: TaskId, text: string, binding: ConstellationContext["binding"]) {
    return this.attempt(C.Note.make({ constellationId: CID, taskId, text }), ctx({ binding }));
  }
}

/**
 * A's first Attempt is sent back and its second accepted; B's is stopped; D, which depends on
 * A, then starts. Along the way: progress, a question and its answer, messages and notes.
 */
export const story = () => {
  const s = new Story();
  const first = () => s.latest(A);

  s.dispatch(A, "a1", WORKER);
  s.run(
    C.WorkerProgress.make({
      constellationId: CID,
      attemptId: first().id,
      note: "Reading the store",
      completed: 1,
      total: 3,
      waiting: null,
    }),
    ctx({ binding: as(WORKER) })
  );
  s.run(
    C.WorkerAsk.make({
      constellationId: CID,
      attemptId: first().id,
      question: new ConstellationQuestion({
        id: "base",
        to: "lead",
        text: "Which base?",
        blocking: false,
      }),
    }),
    ctx({ binding: as(WORKER) })
  );
  s.run(
    C.Answer.make({
      constellationId: CID,
      action: AnswerAction.cases.Question.make({
        attemptId: first().id,
        questionId: "base",
        text: "Use main.",
      }),
    }),
    ctx({ binding: lead })
  );
  s.run(
    C.Message.make({
      constellationId: CID,
      target: MessageTarget.cases.Worker.make({ attemptId: first().id }),
      text: "Keep the fold pure.",
    }),
    ctx({ binding: user })
  );
  s.note(A, "The fold reuses the graph fold.", as(WORKER));
  s.note(A, "Watch the cursor.", lead);
  s.claim(A, "head-1");

  const retry = draft(A, "a2", RETRY, AttemptCause.cases.SentBack.make({ ref: first().id }));

  s.run(
    C.Review.make({
      constellationId: CID,
      attemptId: first().id,
      revision: first().revision,
      action: ReviewAction.cases.SendBack.make({
        reason: "The cursor test is missing.",
        worker: WorkerPlacement.cases.Existing.make({ sessionId: RETRY }),
      }),
    }),
    ctx({ binding: lead, attempts: [retry] })
  );
  s.dispatch(B, "b1", PEER);
  s.run(
    C.WorkerMessage.make({
      constellationId: CID,
      attemptId: s.latest(A).id,
      to: B,
      text: "Which event names the note?",
    }),
    ctx({ binding: as(RETRY) })
  );
  s.claim(A, "head-2");
  s.run(
    C.Review.make({
      constellationId: CID,
      attemptId: s.latest(A).id,
      revision: s.latest(A).revision,
      action: ReviewAction.cases.Accept.make({ mergedHead: "head-2", receipts: [] }),
    }),
    ctx({ binding: lead })
  );
  s.run(
    C.Review.make({
      constellationId: CID,
      attemptId: s.latest(B).id,
      revision: s.latest(B).revision,
      action: ReviewAction.cases.Stop.make({ reason: "No longer needed." }),
    }),
    ctx({ binding: lead })
  );
  s.dispatch(D, "d1", DEPENDENT);

  return s;
};
