import { expect, test } from "bun:test";
import {
  AnswerAction,
  Claim,
  ConstellationQuestion,
  ReviewAction,
  WorkerPlacement,
} from "@polaris/protocol";
import { Predicate, Struct } from "effect";
import {
  C,
  CID,
  LEAD,
  apply,
  claimed,
  ctx,
  draft,
  report,
  dispatched,
} from "./constellation.testing.ts";
import { decideConstellation } from "./constellation.ts";

const reclaim = (head: string, dirtyPaths: string[] = []) => ({
  command: C.WorkerClaim.make({
    constellationId: CID,
    attemptId: draft().id,
    claim: report(draft().branch, head),
  }),
  context: ctx({
    binding: { kind: "session", sessionId: draft().sessionId },
    claimProbe: { dirtyPaths, branch: draft().branch, head },
  }),
});

test("a changed review head supersedes its Claim and clears approval/handoff; stale Accept fails", () => {
  let record = claimed();
  const revision = record.graph.attempts[0]!.revision;
  record = apply(
    record,
    C.Review.make({
      constellationId: CID,
      attemptId: draft().id,
      revision,
      action: ReviewAction.cases.Approve.make({}),
    })
  );
  record = apply(
    record,
    C.Review.make({
      constellationId: CID,
      attemptId: draft().id,
      revision: record.graph.attempts[0]!.revision,
      action: ReviewAction.cases.HandUp.make({ reason: "Review it" }),
    }),
    ctx({ binding: { kind: "session", sessionId: LEAD } })
  );
  const old = record.graph.attempts[0]!;
  const input = reclaim("edited-head");
  const decision = decideConstellation(record, input.command, input.context);
  expect(decision.rejection).toBeNull();
  expect(decision.events.filter((e) => Predicate.isTagged(e, "NotificationQueued"))).toHaveLength(
    1
  );
  record = apply(record, input.command, input.context);
  const revised = record.graph.attempts[0]!;
  expect(revised.id).toBe(old.id);
  expect(revised.revision).toBe(old.revision + 1);
  expect(revised.state).toBe("review");
  expect(revised.claim?.head).toBe("edited-head");
  expect(old.claim?.head).toBe("head");
  expect(revised.approvedByUserAt).toBeNull();
  expect(revised.handedUpAt).toBeNull();
  expect(revised.handedUpReason).toBeNull();

  const accept = (revision: number, head: string) =>
    decideConstellation(
      record,
      C.Review.make({
        constellationId: CID,
        attemptId: revised.id,
        revision,
        action: ReviewAction.cases.Accept.make({ mergedHead: head, receipts: [] }),
      }),
      ctx()
    );

  expect(accept(old.revision, "head").rejection?.findings[0]?.code).toBe("E-REVISION");
  expect(accept(revised.revision, "edited-head").rejection).toBeNull();
});

test("re-claim still requires a clean matching changed branch head", () => {
  const record = claimed();

  for (const [head, dirty, expected] of [
    ["head", [], "E-CLAIM-UNCHANGED"],
    ["edited-head", ["file.ts"], "E-CLAIM-DIRTY"],
  ] as const) {
    const input = reclaim(head, [...dirty]);
    const decision = decideConstellation(record, input.command, input.context);
    expect(decision.rejection?.findings.some((f) => f.code === expected)).toBe(true);
  }

  const input = reclaim("new");

  const mismatched = C.WorkerClaim.make({
    ...input.command,
    claim: Claim.make(Struct.assign(input.command.claim, { branch: "other" })),
  });

  expect(
    decideConstellation(record, mismatched, input.context).rejection?.findings.some(
      (f) => f.code === "E-CLAIM-HEAD"
    )
  ).toBe(true);
});

const openQuestion = ConstellationQuestion.make({
  id: "decision",
  to: "lead",
  text: "Choose the base",
  blocking: true,
});

test("re-claim retains identical open questions and only notifies fresh questions", () => {
  const first = Claim.make(Struct.assign(report(), { questions: [openQuestion] }));
  let record = claimed(dispatched(), first);
  const original = [...record.questions.values()][0]!;
  const input = reclaim("revised");

  const command = C.WorkerClaim.make({
    ...input.command,
    claim: Claim.make(Struct.assign(input.command.claim, { questions: [openQuestion] })),
  });

  const decision = decideConstellation(record, command, input.context);
  expect(decision.rejection).toBeNull();
  expect(decision.events.filter((e) => Predicate.isTagged(e, "NotificationQueued"))).toHaveLength(
    1
  );
  record = apply(record, command, input.context);
  expect([...record.questions.values()]).toEqual([original]);
  expect(record.graph.attempts[0]!.claim?.questions).toEqual([openQuestion]);
});

test("answered, changed and duplicate question ids remain refused on re-claim", () => {
  const record = claimed(
    dispatched(),
    Claim.make(Struct.assign(report(), { questions: [openQuestion] }))
  );

  const input = reclaim("revised");

  const ask = (questions: ConstellationQuestion[], current = record) =>
    decideConstellation(
      current,
      C.WorkerClaim.make({
        ...input.command,
        claim: Claim.make(Struct.assign(input.command.claim, { questions })),
      }),
      input.context
    );

  for (const field of [{ text: "Other question" }, { to: "user" as const }, { blocking: false }])
    expect(
      ask([
        ConstellationQuestion.make({
          id: openQuestion.id,
          text: field.text ?? openQuestion.text,
          to: field.to ?? openQuestion.to,
          blocking: field.blocking ?? openQuestion.blocking,
        }),
      ]).rejection?.findings[0]?.code
    ).toBe("E-QUESTION-EXISTS");
  expect(ask([openQuestion, openQuestion]).rejection?.findings[0]?.code).toBe("E-QUESTION-EXISTS");

  const answered = apply(
    record,
    C.Answer.make({
      constellationId: CID,
      action: AnswerAction.cases.Question.make({
        attemptId: draft().id,
        questionId: openQuestion.id,
        text: "main",
      }),
    }),
    ctx({ binding: { kind: "session", sessionId: LEAD } })
  );

  expect(ask([openQuestion], answered).rejection?.findings[0]?.code).toBe("E-QUESTION-EXISTS");
});

test("a sent-back Attempt's claim refusal explains the next Turn boundary", () => {
  const review = claimed();
  const previous = review.graph.attempts[0]!;

  const record = apply(
    review,
    C.Review.make({
      constellationId: CID,
      attemptId: previous.id,
      revision: previous.revision,
      action: ReviewAction.cases.SendBack.make({
        reason: "Cleanup",
        worker: WorkerPlacement.cases.Existing.make({ sessionId: previous.sessionId }),
      }),
    }),
    ctx({ attempts: [draft(previous.taskId, "retry", previous.sessionId)] })
  );

  const input = reclaim("changed");
  const findings = decideConstellation(record, input.command, input.context).rejection?.findings;
  expect(findings?.[0]?.code).toBe("E-CLAIM-STATE");
  expect(findings?.[0]?.message).toContain("sent back");
  expect(findings?.[0]?.fix).toContain("new Attempt starts after this Turn ends");
});
