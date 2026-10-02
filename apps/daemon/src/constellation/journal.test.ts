import { describe, expect, test } from "bun:test";
import { ConstellationQuestion, DomainEvent, SessionId, Turn, TurnId } from "@polaris/protocol";
import {
  AT,
  C,
  CID,
  LEAD,
  apply,
  claimed,
  ctx,
  dispatched,
  foldDecision,
} from "../engine/constellation.testing.ts";
import { decideConstellationJournal } from "./journal.ts";

const turnEvents = (sessionId = LEAD, id = "digest") => [
  DomainEvent.cases.TurnStarted.make({
    turn: new Turn({
      id: TurnId.make(id),
      sessionId,
      index: 0,
      prompt: "Digest",
      attachments: [],
      model: null,
      effort: null,
      status: "working",
      checkpointBefore: null,
      checkpointAfter: null,
      startedAt: AT,
      endedAt: null,
    }),
  }),
];

describe("Constellation delivery journal", () => {
  test("an offline worker stays active until an explicit settlement command", () => {
    const record = dispatched();
    const attempt = record.graph.attempts[0]!;

    const input = {
      type: "settle" as const,
      attemptId: attempt.id,
      outcome: "lost" as const,
      reason: "Host offline",
    };

    const offlineSessionIds = new Set([attempt.sessionId]);
    expect(
      decideConstellationJournal(record, input, ctx({ offlineSessionIds, commanded: false })).events
    ).toEqual([]);
    expect(
      decideConstellationJournal(record, input, ctx({ offlineSessionIds, commanded: true }))
        .rejection
    ).toBeNull();
  });
  test("silent-end nudge journals once with its Turn and survives replay", () => {
    const record = dispatched();
    const attempt = record.graph.attempts[0]!;

    const input = {
      type: "nudged" as const,
      attemptId: attempt.id,
      turnId: TurnId.make("nudge"),
      turnEvents: turnEvents(attempt.sessionId, "nudge"),
    };

    expect(decideConstellationJournal(record, { ...input, turnEvents: [] }, ctx()).events).toEqual(
      []
    );
    const decision = decideConstellationJournal(record, input, ctx());
    expect(decision.rejection).toBeNull();
    const nudged = foldDecision(record, decision.events);
    expect(nudged.graph.attempts[0]?.nudgedAt).toBe(AT);
    expect(nudged.graph.attempts[0]?.state).toBe("working");
    expect(decideConstellationJournal(nudged, input, ctx()).events).toEqual([]);
  });
  test("delivery consumes pending IDs once and requires the matching current Lead Turn atomically", () => {
    const record = claimed();

    const input = {
      type: "notified" as const,
      leadSessionId: LEAD,
      items: record.graph.pendingNotifications.map((n) => n.id),
      turnId: TurnId.make("digest"),
      turnEvents: turnEvents(),
    };

    const decision = decideConstellationJournal(record, input, ctx());
    expect(decision.rejection).toBeNull();
    const delivered = foldDecision(record, decision.events);
    expect(delivered.graph.pendingNotifications).toEqual([]);
    expect(delivered.delivered.size).toBe(input.items.length);
    expect(decideConstellationJournal(delivered, input, ctx()).rejection?.findings[0]?.code).toBe(
      "E-DELIVERY-ITEMS"
    );
    expect(
      decideConstellationJournal(record, { ...input, turnEvents: [] }, ctx()).rejection?.findings[0]
        ?.code
    ).toBe("E-DELIVERY-TURN");
    expect(
      decideConstellationJournal(record, { ...input, leadSessionId: SessionId.make("old") }, ctx())
        .rejection?.findings[0]?.code
    ).toBe("E-DELIVERY-LEAD");
  });
  test("recovery is idempotent and a second interruption needs attention", () => {
    const before = dispatched();
    const first = before.graph.attempts[0]!;

    const record = foldDecision(before, [
      DomainEvent.cases.AttemptInterrupted.make({
        constellationId: CID,
        revision: before.graph.revision,
        attemptId: first.id,
        turnId: TurnId.make("recover"),
        interruptionId: "first",
        eligible: true,
        at: AT,
      }),
    ]);

    const attempt = record.graph.attempts[0]!;

    const input = {
      type: "recoveryContinued" as const,
      attemptId: attempt.id,
      turnId: TurnId.make("recover"),
      interruptionId: "first",
      turnEvents: turnEvents(attempt.sessionId, "recover"),
    };

    expect(decideConstellationJournal(before, input, ctx()).rejection?.findings[0]?.code).toBe(
      "E-RECOVERY-PROOF"
    );

    const decision = decideConstellationJournal(record, input, ctx());
    expect(decision.rejection).toBeNull();
    const continued = foldDecision(record, decision.events);
    expect(decideConstellationJournal(continued, input, ctx()).events).toEqual([]);
    expect(
      decideConstellationJournal(continued, { ...input, interruptionId: "second" }, ctx()).rejection
        ?.findings[0]?.code
    ).toBe("E-RECOVERY-LIMIT");
  });
  test("questions and in-transit messages survive folds and questions cannot be answered twice", () => {
    const record = dispatched();
    const attempt = record.graph.attempts[0]!;

    const asked = apply(
      record,
      C.WorkerAsk.make({
        constellationId: CID,
        attemptId: attempt.id,
        question: new ConstellationQuestion({
          id: "q",
          to: "lead",
          text: "Which base?",
          blocking: true,
        }),
      }),
      ctx({ binding: { kind: "session", sessionId: attempt.sessionId } })
    );

    expect(asked.questions.size).toBe(1);
    expect(asked.graph.pendingNotifications).toHaveLength(1);

    const settled = decideConstellationJournal(
      asked,
      { type: "settle", attemptId: attempt.id, outcome: "failed", reason: "Harness failed" },
      ctx()
    );

    const next = foldDecision(asked, settled.events);
    expect(next.graph.attempts[0]?.state).toBe("failed");
    expect(next.questions.size).toBe(1);
    expect(
      decideConstellationJournal(
        next,
        { type: "settle", attemptId: attempt.id, outcome: "lost", reason: "again" },
        ctx()
      ).events
    ).toEqual([]);
  });
});
