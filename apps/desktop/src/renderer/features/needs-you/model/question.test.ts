import { expect, test } from "bun:test";
import {
  AttemptId,
  ConstellationNotification,
  ConstellationQuestion,
  DomainEvent,
  MessageTarget,
  NotificationItem,
  SessionId,
  TurnId,
} from "@polaris/protocol";
import { applyEnvelopes, startedRecord } from "../../constellation/model/fold.ts";
import { plainFacts } from "../../constellation/model/facts.ts";
import { buildRail } from "../../constellation/model/rail.ts";
import type { TaskRow } from "../../constellation/model/task.ts";
import type { ConstellationsModel } from "../../constellation/model/types.ts";
import { C1, HOSTS, MODELS } from "../../sessions/preview/fixtures.ts";
import { buildConstellationInbox } from "./constellation.ts";

const E = DomainEvent.cases;

const B1 = AttemptId.make("c1-B1-1");

const graph = { constellationId: C1.constellation.id };

const question = ConstellationQuestion.make({
  id: "dmg-light-labels",
  to: "user",
  text: "Light or dark labels on the DMG background?",
  blocking: true,
});

const queued = (id: string, item: NotificationItem, sequence: number) => ({
  sequence,
  occurredAt: "2026-10-01T12:00:00Z",
  event: E.NotificationQueued.make({
    ...graph,
    revision: 37 + sequence,
    notification: new ConstellationNotification({ id, item, queuedAt: "2026-10-01T12:00:00Z" }),
  }),
});

/** B1 claims with a question to the user: the Claim's settle and the question queue together. */
const claimedWithQuestion = (): ConstellationsModel => {
  const start = startedRecord(
    { ...C1.constellation, pendingNotifications: [], openQuestions: [] },
    1
  );

  const loaded = { listed: new Map(), byId: new Map([[start.constellation.id, start]]) };

  return applyEnvelopes(loaded, [
    queued("n-settled", NotificationItem.cases.Settled.make({ attemptId: B1, state: "review" }), 2),
    queued("n-question", NotificationItem.cases.Question.make({ attemptId: B1, question }), 3),
  ]);
};

/** The Lead's digest delivers both: the Claim is Lead-worthy, so the window opens and closes. */
const digested = (model: ConstellationsModel) =>
  applyEnvelopes(model, [
    {
      sequence: 4,
      occurredAt: "2026-10-01T12:00:20Z",
      event: E.LeadNotified.make({
        ...graph,
        revision: 41,
        leadSessionId: SessionId.make("lead-c1"),
        items: ["n-settled", "n-question"],
        turnId: TurnId.make("t-digest"),
      }),
    },
  ]);

const questionItems = (model: ConstellationsModel) => {
  const record = model.byId.get(graph.constellationId)!;

  const inbox = buildConstellationInbox({
    hosts: HOSTS,
    models: MODELS,
    views: { local: [record] },
  });

  return (inbox.groups[0]?.items ?? []).flatMap((i) =>
    i.kind === "question" ? [[`${i.taskId}`, i.question?.id]] : []
  );
};

const b1Row = (model: ConstellationsModel) =>
  buildRail(model.byId.get(graph.constellationId)!, plainFacts()).tasks.find(
    (r: TaskRow) => r.task.id === "B1"
  );

const later = (sequence: number, event: DomainEvent) => [
  { sequence, occurredAt: "2026-10-01T12:05:00Z", event },
];

test("a question to the user raised with a Claim stays in Needs you after the Lead's digest", () => {
  const model = digested(claimedWithQuestion());

  expect(questionItems(model)).toEqual([["B1", "dmg-light-labels"]]);
  // The row reads as waiting on the user, not as the Lead reviewing.
  expect(b1Row(model)?.look.word).toBe("asks you");
  expect(b1Row(model)?.line).toEqual({
    kind: "note",
    text: question.text,
    tone: "needs-you",
    detail: null,
  });
});

test("the user's answer closes the question; only that Attempt's question of that id", () => {
  const other = AttemptId.make("c1-B4-1");

  const both = applyEnvelopes(digested(claimedWithQuestion()), [
    queued("n-other", NotificationItem.cases.Question.make({ attemptId: other, question }), 5),
  ]);

  const answered = applyEnvelopes(
    both,
    later(
      6,
      E.OperatorMessageSent.make({
        ...graph,
        revision: 44,
        id: "answer-1",
        authority: "conversation",
        target: MessageTarget.cases.Worker.make({ attemptId: B1 }),
        text: "Light",
        questionId: question.id,
      })
    )
  );

  expect(questionItems(answered)).toEqual([["B4", "dmg-light-labels"]]);
});

test("a question closes when its Attempt settles", () => {
  const model = digested(claimedWithQuestion());

  const b1 = model.byId
    .get(graph.constellationId)!
    .constellation.attempts.find((a) => a.id === B1)!;

  const accepted = applyEnvelopes(
    model,
    later(
      5,
      E.AttemptAccepted.make({
        ...graph,
        revision: 42,
        attemptId: B1,
        attemptRevision: b1.revision + 1,
        mergedHead: "abc123",
        receipts: [],
        evidence: "asserted",
      })
    )
  );

  expect(questionItems(accepted)).toEqual([]);
  expect(accepted.byId.get(graph.constellationId)?.constellation.openQuestions).toEqual([]);
});
