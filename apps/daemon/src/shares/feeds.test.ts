import {
  ApprovalDecision,
  DomainEvent,
  EventEnvelope,
  RequestId,
  Sequence,
  SessionStreamItem,
} from "@polaris/protocol";
import { expect, test } from "bun:test";
import { Effect, Predicate, Stream } from "effect";
import { approval, SESSION_ID, session } from "../push/push.testing.ts";
import { teammateSessionFeed } from "./feeds.ts";

const event = (domain: DomainEvent, sequence: number) =>
  SessionStreamItem.cases.Event.make({
    envelope: new EventEnvelope({
      sequence: Sequence.make(sequence),
      occurredAt: "2026-11-16T12:00:00.000Z",
      commandId: null,
      event: domain,
    }),
  });

const resolved = (id: string, decision: ApprovalDecision, sequence: number) =>
  event(
    DomainEvent.cases.ApprovalResolved.make({
      sessionId: SESSION_ID,
      requestId: RequestId.make(id),
      decision,
      resolvedBy: "MacBook",
    }),
    sequence
  );

test("a Teammate's session feed never shows the owner's Secret Requests or a secret provided", async () => {
  const feed = [
    SessionStreamItem.cases.Snapshot.make({
      sequence: Sequence.make(1),
      session,
      turns: [],
      pendingApprovals: [approval("s0", "secret"), approval("r0")],
    }),
    event(DomainEvent.cases.ApprovalRequested.make({ request: approval("s1", "secret") }), 2),
    event(DomainEvent.cases.ApprovalRequested.make({ request: approval("r1") }), 3),
    resolved("s1", ApprovalDecision.cases.Provided.make({}), 4),
    resolved("r1", ApprovalDecision.cases.Allow.make({ remember: false }), 5),
  ];

  const seen = await Effect.runPromise(
    Stream.runCollect(teammateSessionFeed(Stream.fromIterable(feed)))
  );

  const pending = seen.flatMap((item) =>
    Predicate.isTagged(item, "Snapshot") ? item.pendingApprovals.map((r) => String(r.id)) : []
  );

  const sequences = seen.flatMap((item) =>
    Predicate.isTagged(item, "Event") ? [Number(item.envelope.sequence)] : []
  );

  expect(pending).toEqual(["r0"]);
  expect(sequences).toEqual([3, 5]);
});
