import { expect, test } from "bun:test";
import {
  CommandId,
  DomainEvent,
  EventEnvelope,
  HostStreamItem,
  Sequence,
  SessionStreamItem,
  SessionSummary,
} from "@polaris/protocol";
import { Predicate } from "effect";
import { hostItemsFor, sessionItemsFor } from "./limitedCompat.ts";
import { AT, initialSnapshot, RESETS_AT, SESSION, stepModel } from "./session.testing.ts";

const limited = (() => {
  const options = { harness: "claude", liveCoAttach: false, switchModel: false } as const;
  const started = stepModel(initialSnapshot(), { type: "start" }, options).next;

  return stepModel(started, { type: "limitTurn" }, options).next.machine.context.record!.session;
})();

const envelope = (event: DomainEvent) =>
  new EventEnvelope({
    sequence: Sequence.make(7),
    occurredAt: AT,
    commandId: CommandId.make("c"),
    event,
  });

const limitedEvent = DomainEvent.cases.SessionStateChanged.make({
  sessionId: SESSION,
  state: "limited",
  reason: "You've hit your limit",
  resetsAt: RESETS_AT,
});

test("a Client that announced session.limited gets Limited as is", () => {
  expect(hostItemsFor(["session.limited"])).toBeNull();
  expect(sessionItemsFor(["session.limited"])).toBeNull();
});

test("an older Client reads a Limited session as Failed, with the limit as its error", () => {
  const host = hostItemsFor([])!;
  const session = sessionItemsFor([])!;

  const snapshot = host(
    HostStreamItem.cases.Snapshot.make({
      sequence: Sequence.make(7),
      workspaces: [],
      worktrees: [],
      sessions: [
        new SessionSummary({
          session: limited,
          pendingApprovals: [],
          lastTurnPreview: null,
          subagents: [],
        }),
      ],
      reviewCheckouts: [],
    })
  );

  expect(Predicate.isTagged(snapshot, "Snapshot") && snapshot.sessions[0]!.session).toMatchObject({
    state: "failed",
    lastError: "Usage limit",
  });

  for (const item of [
    host(HostStreamItem.cases.Event.make({ envelope: envelope(limitedEvent) })),
    session(SessionStreamItem.cases.Event.make({ envelope: envelope(limitedEvent) })),
  ])
    expect(Predicate.isTagged(item, "Event") && item.envelope.event).toEqual(
      DomainEvent.cases.SessionStateChanged.make({
        sessionId: SESSION,
        state: "failed",
        reason: "You've hit your limit",
      })
    );

  const other = envelope(
    DomainEvent.cases.SessionStateChanged.make({ sessionId: SESSION, state: "idle", reason: null })
  );

  const passed = session(SessionStreamItem.cases.Event.make({ envelope: other }));
  expect(Predicate.isTagged(passed, "Event") && passed.envelope).toBe(other);
});
