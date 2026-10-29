import { expect, test } from "bun:test";
import {
  type AttemptId,
  AttemptCause,
  Constellation,
  ConstellationSettings,
  DomainEvent,
  EventEnvelope,
  Sequence,
  Task,
  TaskId,
} from "@polaris/protocol";
import {
  A,
  AT,
  B,
  CID,
  G,
  HOST,
  LEAD,
  WS,
  draft,
  report,
} from "../../engine/constellation.testing.ts";
import { reviewStats } from "./review.ts";
import { time } from "./stats.testing.ts";

const P = TaskId.make("P");

const task = (id: TaskId, patch: Partial<Task> = {}) =>
  Task.make({
    id,
    title: id,
    kind: "task",
    deps: [],
    area: [],
    brief: "Build it",
    criteria: [],
    suggested: null,
    group: null,
    revision: 0,
    canceled: false,
    ...patch,
  });

const a1 = draft(A, "a1");

const b1 = draft(B, "b1");

const b2 = draft(B, "b2", undefined, AttemptCause.cases.SentBack.make({ ref: b1.id }));

const g1 = draft(G, "g1");

/** Parent P holds A and B; Gate G fans in on both. Only A, B and G carry Attempts. */
const graph = Constellation.make({
  id: CID,
  workspaceId: WS,
  hostId: HOST,
  leadSessionId: LEAD,
  name: "Fixture",
  state: "completed",
  revision: 9,
  settings: ConstellationSettings.make({}),
  tasks: [
    task(P),
    task(A, { parent: P }),
    task(B, { parent: P }),
    task(G, { kind: "gate", deps: [A, B] }),
  ],
  attempts: [a1, b1, b2, g1],
  pendingNotifications: [],
  createdAt: AT,
  updatedAt: time(20_000),
});

const fields = { constellationId: CID, revision: 1 };

const claimed = (attemptId: AttemptId) =>
  DomainEvent.cases.AttemptClaimed.make({
    ...fields,
    attemptId,
    attemptRevision: 1,
    claim: report(),
  });

const accepted = (attemptId: AttemptId) =>
  DomainEvent.cases.AttemptAccepted.make({
    ...fields,
    attemptId,
    attemptRevision: 2,
    mergedHead: "head",
    receipts: [],
    evidence: "asserted",
  });

const events = [
  claimed(a1.id),
  // A's worker amends its Claim while in review: still A's first Claim, never sent back.
  claimed(a1.id),
  accepted(a1.id),
  claimed(b1.id),
  DomainEvent.cases.AttemptRejected.make({
    ...fields,
    attemptId: b1.id,
    attemptRevision: 2,
    reason: "tests fail",
    by: "lead",
  }),
  claimed(b2.id),
  accepted(b2.id),
  claimed(g1.id),
  accepted(g1.id),
].map((event, i) =>
  EventEnvelope.make({
    sequence: Sequence.make(i + 1),
    occurredAt: time((i + 1) * 1000),
    commandId: null,
    event,
  })
);

test("first-time acceptance counts each Task with an Attempt once, amended Claims included, never Parents", () => {
  expect(reviewStats(graph, events)).toMatchObject({
    firstClaimsReviewed: 3,
    acceptedFirstTime: 2,
    sendBacksByCause: [{ cause: "SentBack", count: 1 }],
  });
});

test("an amended Claim's review time runs from when it first went into review", () => {
  const amended = reviewStats(graph, events.slice(0, 3));

  expect(amended.decidedClaims).toBe(1);
  expect(amended.medianClaimToReviewMs).toBe(2000);
});
