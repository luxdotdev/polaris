import { describe, expect, test } from "bun:test";
import {
  AnswerAction,
  Claim,
  ConstellationEvent,
  ConstellationQuestion,
  ReviewAction,
  SessionId,
  TurnId,
  WorkerPlacement,
} from "@polaris/protocol";
import { Struct } from "effect";
import { statusOutline } from "../constellation/status.ts";
import { foldConstellation, type ConstellationRecord } from "../store/constellation.ts";
import {
  A,
  AT,
  C,
  CID,
  LEAD,
  apply,
  claimed,
  ctx,
  dispatched,
  draft,
  report,
} from "./constellation.testing.ts";
import { decideConstellation } from "./constellation.ts";

const toUser = ConstellationQuestion.make({
  id: "dmg-light-labels",
  to: "user",
  text: "Light or dark labels on the DMG background?",
  blocking: true,
});

const withQuestion = Claim.make(Struct.assign(report(), { questions: [toUser] }));

/** The Lead's digest delivers everything queued, as `delivery/local.ts` does. */
const digest = (record: ConstellationRecord) =>
  foldConstellation(
    record,
    ConstellationEvent.cases.LeadNotified.make({
      constellationId: CID,
      revision: record.graph.revision + 1,
      leadSessionId: LEAD,
      items: record.graph.pendingNotifications.map((n) => n.id),
      turnId: TurnId.make("t-digest"),
    }),
    AT
  )!;

const answer = (record: ConstellationRecord, binding = ctx()) =>
  decideConstellation(
    record,
    C.Answer.make({
      constellationId: CID,
      action: AnswerAction.cases.Question.make({
        attemptId: record.graph.attempts[0]!.id,
        questionId: toUser.id,
        text: "Light",
      }),
    }),
    binding
  );

const review = (record: ConstellationRecord, action: ReviewAction, context = ctx()) => {
  const attempt = record.graph.attempts[0]!;

  return apply(
    record,
    C.Review.make({
      constellationId: CID,
      attemptId: attempt.id,
      revision: attempt.revision,
      action,
    }),
    context
  );
};

const open = (record: ConstellationRecord) => record.graph.openQuestions.map((q) => q.question.id);

describe("a question raised at Claim time (ENG-265)", () => {
  test("stays open after the Lead's digest empties the delivery queue", () => {
    const record = digest(claimed(dispatched(), withQuestion));

    expect(record.graph.pendingNotifications).toEqual([]);
    expect(open(record)).toEqual([toUser.id]);
    expect(statusOutline(record)).toContain(`Question ${toUser.id}`);
  });

  test("the Lead still can't answer it; the user's answer closes it", () => {
    const record = digest(claimed(dispatched(), withQuestion));

    expect(
      answer(record, ctx({ binding: { kind: "session", sessionId: LEAD } })).rejection?.findings[0]
        ?.code
    ).toBe("E-AUTHORITY");

    const decision = answer(record);
    expect(decision.rejection).toBeNull();

    let next = record;

    for (const event of decision.events)
      if ("constellationId" in event) next = foldConstellation(next, event, AT)!;

    expect(open(next)).toEqual([]);
    expect(statusOutline(next)).not.toContain(`Question ${toUser.id}`);
  });
});

describe("open questions close when their Attempt settles (ENG-273)", () => {
  const settled = {
    accepted: (r: ConstellationRecord) =>
      review(r, ReviewAction.cases.Accept.make({ mergedHead: "head", receipts: [] })),
    "sent back": (r: ConstellationRecord) =>
      review(
        r,
        ReviewAction.cases.SendBack.make({
          reason: "Cleanup",
          worker: WorkerPlacement.cases.Existing.make({ sessionId: SessionId.make("worker") }),
        }),
        ctx({ attempts: [draft(A, "a2")] })
      ),
    stopped: (r: ConstellationRecord) =>
      review(r, ReviewAction.cases.Stop.make({ reason: "Not needed" })),
  };

  for (const [name, settle] of Object.entries(settled))
    test(`${name}: gone from status, and an answer is refused as closed`, () => {
      const record = settle(digest(claimed(dispatched(), withQuestion)));

      expect(open(record)).toEqual([]);
      expect(statusOutline(record)).not.toContain(`Question ${toUser.id}`);
      expect(answer(record).rejection?.findings[0]?.code).toBe("E-QUESTION-CLOSED");
    });

  test("a question asked while working closes when the worker is stopped", () => {
    const record = dispatched();
    const attempt = record.graph.attempts[0]!;

    const asked = apply(
      record,
      C.WorkerAsk.make({ constellationId: CID, attemptId: attempt.id, question: toUser }),
      ctx({ binding: { kind: "session", sessionId: attempt.sessionId } })
    );

    expect(open(asked)).toEqual([toUser.id]);

    const stopped = foldConstellation(
      asked,
      ConstellationEvent.cases.AttemptSettled.make({
        constellationId: CID,
        revision: asked.graph.revision + 1,
        attemptId: attempt.id,
        attemptRevision: attempt.revision + 1,
        outcome: "lost",
        reason: "stopped",
      }),
      AT
    )!;

    expect(open(stopped)).toEqual([]);
  });
});
