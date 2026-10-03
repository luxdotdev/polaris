import { expect, test } from "bun:test";
import {
  ConstellationEvent,
  DomainEvent,
  MessageTarget,
  PlanOperation,
  WorkerPlacement,
  ReviewAction,
  SessionId,
  TaskId,
  TurnId,
} from "@polaris/protocol";
import { Schema } from "effect";
import { decideConstellation } from "../engine/constellation.ts";
import {
  A,
  B,
  C,
  CID,
  AT,
  ctx,
  dispatched,
  planned,
  task,
  apply,
  foldDecision,
  draft,
  claimed,
} from "../engine/constellation.testing.ts";
import { projectTask } from "./projections.ts";
import { decideConstellationJournal } from "./journal.ts";
import { pendingInputs } from "./delivery/messages.ts";
import { newTurn } from "./delivery/turns.ts";
import { session } from "./delivery/testing.ts";
import { digestPrompt, digestDelay } from "./delivery/format.ts";
import { statusOutline } from "./status.ts";

const working = () => dispatched(planned([task(A), task(B)]));

const command = (on: TaskId[] = [B]) =>
  C.WorkerBlock.make({
    constellationId: CID,
    attemptId: draft().id,
    on,
    reason: "Waiting for the feed",
  });

const workerContext = () => ctx({ binding: { kind: "session", sessionId: draft().sessionId } });

const blocked = (on: TaskId[] = [B]) => apply(working(), command(on), workerContext());

test("block validates state, each target condition and already accepted targets", () => {
  const code = (record: ReturnType<typeof working>, on: TaskId[]) =>
    decideConstellation(record, command(on), workerContext()).rejection?.findings[0]?.code;

  expect(code(blocked(), [B])).toBe("E-BLOCK-STATE");
  expect(code(claimed(working()), [B])).toBe("E-BLOCK-STATE");

  const settled = foldDecision(working(), [
    ConstellationEvent.cases.AttemptSettled.make({
      constellationId: CID,
      revision: 2,
      attemptId: draft().id,
      attemptRevision: 1,
      outcome: "lost",
      reason: "Stopped",
    }),
  ]);

  expect(code(settled, [B])).toBe("E-BLOCK-STATE");
  expect(code(working(), [A])).toBe("E-BLOCK-TARGET");
  expect(code(working(), [TaskId.make("missing")])).toBe("E-BLOCK-TARGET");

  const canceled = apply(
    working(),
    C.Plan.make({
      constellationId: CID,
      operations: [PlanOperation.cases.Cancel.make({ taskId: B, revision: 0 })],
    })
  );

  expect(code(canceled, [B])).toBe("E-BLOCK-TARGET");
  const record = working();
  const accepted = dispatched(record, draft(B, "b1", SessionId.make("worker-b")));

  const acceptedRecord = foldDecision(accepted, [
    ConstellationEvent.cases.AttemptAccepted.make({
      constellationId: CID,
      revision: accepted.graph.revision + 1,
      attemptId: accepted.graph.attempts[1]!.id,
      attemptRevision: 1,
      mergedHead: "feed-head",
      receipts: [],
      evidence: "asserted",
    }),
  ]);

  expect(code(acceptedRecord, [B])).toBe("E-BLOCK-SATISFIED");
  expect(decideConstellation(working(), command(), ctx()).rejection?.findings[0]?.code).toBe(
    "E-AUTHORITY"
  );
  expect(() => Schema.decodeUnknownSync(C.WorkerBlock)({ ...command(), reason: "" })).toThrow();
});

test("block persists metadata, projects blockers and queues a Lead digest", () => {
  const record = blocked([B, B]);
  expect(record.graph.attempts[0]).toMatchObject({
    state: "blocked",
    blockedOn: [B],
    blockedReason: "Waiting for the feed",
    blockedAt: AT,
  });
  expect(projectTask(record, record.graph.tasks[0]!)).toMatchObject({
    state: "blocked",
    blockedBy: [B],
  });
  expect(statusOutline(record)).toContain("blocked by B: Waiting for the feed");
  expect(digestPrompt(record)).toContain("A: blocked by B: Waiting for the feed");
  expect(digestDelay(record)).toBe(20000);
  expect(pendingInputs(blocked([]))).toEqual([]);
});

test("Lead unblock requires a Turn, clears metadata and is idempotent after replay", () => {
  const record = apply(
    blocked([]),
    C.Message.make({
      constellationId: CID,
      target: MessageTarget.cases.Worker.make({ attemptId: draft().id }),
      text: "Use the existing feed",
    })
  );

  const input = pendingInputs(record)[0]!;

  const delivered = {
    type: "inputDelivered" as const,
    id: input.id,
    sessionId: input.sessionId,
    turnEvents: Array<DomainEvent>(),
  };

  expect(decideConstellationJournal(record, delivered, ctx()).rejection?.findings[0]?.code).toBe(
    "E-UNBLOCK-TURN"
  );
  const turn = newTurn(session(input.sessionId), input.text, AT, "resume");

  const decision = decideConstellationJournal(
    record,
    { ...delivered, turnEvents: [DomainEvent.cases.TurnStarted.make({ turn })] },
    ctx()
  );

  expect(decision.rejection).toBeNull();
  expect(decision.events.map((e) => e._tag)).toEqual([
    "TurnStarted",
    "AttemptUnblocked",
    "WorkerInputDelivered",
    "OperatorMessageResolved",
  ]);
  const resumed = foldDecision(record, decision.events);
  expect(resumed.graph.attempts[0]).toMatchObject({
    state: "working",
    blockedOn: [],
    blockedReason: null,
    blockedAt: null,
  });
  expect(decideConstellationJournal(resumed, delivered, ctx()).events).toEqual([]);
});

test("blocked Attempts allow Lead Stop and SendBack and reject nudging", () => {
  const record = blocked();

  const base = {
    constellationId: CID,
    attemptId: draft().id,
    revision: record.graph.attempts[0]!.revision,
  };

  const stopped = apply(
    record,
    C.Review.make({
      ...base,
      action: ReviewAction.cases.Stop.make({ reason: "Canceled approach" }),
    })
  );

  expect(stopped.graph.attempts[0]!.state).toBe("lost");
  const replacement = draft(A, "retry", SessionId.make("new-worker"));

  const sentBack = apply(
    record,
    C.Review.make({
      ...base,
      action: ReviewAction.cases.SendBack.make({
        reason: "Use another approach",
        worker: WorkerPlacement.cases.Existing.make({ sessionId: replacement.sessionId }),
      }),
    }),
    ctx({ attempts: [replacement] })
  );

  expect(sentBack.graph.attempts.map((a) => a.state)).toEqual(["rejected", "working"]);
  expect(
    decideConstellationJournal(
      record,
      { type: "nudged", attemptId: draft().id, turnId: TurnId.make("nudge"), turnEvents: [] },
      ctx()
    ).rejection?.findings[0]?.code
  ).toBe("E-NUDGE-TURN");
});

test("status only labels the silent end after a nudge, and never a resumed or claimed Attempt", () => {
  const record = working();
  const attempt = record.graph.attempts[0]!;

  const nudged = foldDecision(record, [
    ConstellationEvent.cases.AttemptNudged.make({
      constellationId: CID,
      revision: record.graph.revision + 1,
      attemptId: attempt.id,
      attemptRevision: 1,
      at: AT,
    }),
  ]);

  const s = session(attempt.sessionId);

  const created = foldSession(
    s.id,
    undefined,
    [DomainEvent.cases.SessionCreated.make({ session: s })],
    AT
  )!;

  const stopped = foldSession(
    s.id,
    created,
    [DomainEvent.cases.SessionStateChanged.make({ sessionId: s.id, state: "idle", reason: null })],
    "2026-10-02T00:00:00.000Z"
  )!;

  expect(statusOutline(nudged, new Map([[s.id, stopped]]))).toContain("Stopped without claiming");

  const resumed = foldSession(
    s.id,
    stopped,
    [
      DomainEvent.cases.SessionStateChanged.make({
        sessionId: s.id,
        state: "working",
        reason: null,
      }),
    ],
    "2026-10-02T00:00:01.000Z"
  )!;

  expect(statusOutline(nudged, new Map([[s.id, resumed]]))).not.toContain(
    "Stopped without claiming"
  );
  expect(statusOutline(claimed(nudged), new Map([[s.id, stopped]]))).not.toContain(
    "Stopped without claiming"
  );
  const waiting = apply(nudged, command(), workerContext());
  expect(statusOutline(waiting, new Map([[s.id, stopped]]))).not.toContain(
    "Stopped without claiming"
  );
});

import { foldSession } from "../store/model.ts";
