/** A Teammate acting as the user through a Share: Constellation events and the Lead name them. */
import { expect, test } from "bun:test";
import {
  Actor,
  AnswerAction,
  ConstellationQuestion,
  MessageTarget,
  PersonId,
  ReviewAction,
  SessionId,
  ShareId,
  WorkerPlacement,
} from "@polaris/protocol";
import { Predicate } from "effect";
import { decideConstellation } from "../engine/constellation.ts";
import {
  A,
  C,
  CID,
  apply,
  claimed,
  ctx,
  dispatched,
  draft,
  foldDecision,
  planned,
} from "../engine/constellation.testing.ts";
import { notificationLine } from "./delivery/format.ts";

const octocat = Actor.cases.Teammate.make({
  shareId: ShareId.make("share_1"),
  personId: PersonId.make("p1"),
  name: "The Octocat",
});

const asTeammate = (patch: Parameters<typeof ctx>[0] = {}) =>
  ctx({ ...patch, binding: { kind: "user", actor: octocat } });

/** The Lead's lines for what is pending on `record`. */
const leadHears = (record: ReturnType<typeof claimed>) =>
  record.graph.pendingNotifications.map((n) => notificationLine(record, n));

const review = (record: ReturnType<typeof claimed>, action: typeof ReviewAction.Type) =>
  C.Review.make({
    constellationId: CID,
    attemptId: record.graph.attempts.at(-1)!.id,
    revision: record.graph.attempts.at(-1)!.revision,
    action,
  });

test("a Teammate's approval is recorded as theirs, and the Lead hears their name", () => {
  const record = claimed();

  const decision = decideConstellation(
    record,
    review(record, ReviewAction.cases.Approve.make({})),
    asTeammate()
  );

  expect(decision.events.find((e) => Predicate.isTagged(e, "ClaimApproved"))).toMatchObject({
    by: "user",
    actor: octocat,
  });
  expect(leadHears(foldDecision(record, decision.events)).join("\n")).toContain(
    "approved by The Octocat (a Teammate)"
  );
  // The owner's approval reads as before.
  expect(
    leadHears(apply(record, review(record, ReviewAction.cases.Approve.make({})))).join("\n")
  ).toContain("approved by the user");
});

test("a Teammate's send-back and the Attempt it starts are recorded as theirs", () => {
  const record = claimed();

  const sentBack = apply(
    record,
    review(
      record,
      ReviewAction.cases.SendBack.make({
        reason: "fix the test",
        worker: WorkerPlacement.cases.Existing.make({ sessionId: SessionId.make("worker") }),
        mergeConflictBase: null,
      })
    ),
    asTeammate({ attempts: [draft(A, "a2")] })
  );

  expect(sentBack.graph.attempts[0]?.reviewedBy).toEqual(octocat);
  expect(leadHears(sentBack).join("\n")).toContain("sent back by The Octocat (a Teammate)");

  const started = decideConstellation(
    planned(),
    C.Dispatch.make({
      constellationId: CID,
      tasks: [
        {
          taskId: A,
          worker: WorkerPlacement.cases.Existing.make({ sessionId: SessionId.make("worker") }),
        },
      ],
    }),
    asTeammate({ attempts: [draft()] })
  );

  expect(started.events.find((e) => Predicate.isTagged(e, "AttemptStarted"))).toMatchObject({
    actor: octocat,
  });
});

test("a Teammate's message and answer are recorded as theirs, and the Lead hears who sent them", () => {
  const record = dispatched();
  const attempt = record.graph.attempts[0]!;

  const told = decideConstellation(
    record,
    C.Message.make({
      constellationId: CID,
      target: MessageTarget.cases.Worker.make({ attemptId: attempt.id }),
      text: "use base2",
      authority: "conversation",
    }),
    asTeammate()
  );

  expect(told.events.find((e) => Predicate.isTagged(e, "OperatorMessageSent"))).toMatchObject({
    actor: octocat,
  });
  expect(leadHears(foldDecision(record, told.events))).toContain(
    `The Octocat (a Teammate) told ${attempt.taskId}: use base2`
  );

  const asked = apply(
    record,
    C.WorkerAsk.make({
      constellationId: CID,
      attemptId: attempt.id,
      question: new ConstellationQuestion({ id: "q", to: "user", text: "Which?", blocking: true }),
    }),
    ctx({ binding: { kind: "session", sessionId: attempt.sessionId } })
  );

  const answered = decideConstellation(
    asked,
    C.Answer.make({
      constellationId: CID,
      action: AnswerAction.cases.Question.make({
        attemptId: attempt.id,
        questionId: "q",
        text: "base2",
      }),
    }),
    asTeammate()
  );

  expect(answered.events.find((e) => Predicate.isTagged(e, "OperatorMessageSent"))).toMatchObject({
    actor: octocat,
  });
  expect(leadHears(foldDecision(asked, answered.events)).join("\n")).toContain(
    "received an answer from The Octocat (a Teammate) to q: base2"
  );
});
