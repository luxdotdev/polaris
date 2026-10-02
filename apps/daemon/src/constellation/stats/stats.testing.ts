import {
  Attempt,
  Constellation,
  ConstellationSettings,
  DomainEvent,
  EventEnvelope,
  ResourceLease,
  Sequence,
  SessionId,
  Task,
  TokenCounts,
  Turn,
  TurnId,
  UsageBucket,
  ReportedCost,
} from "@polaris/protocol";
import {
  A,
  B,
  AT,
  CID,
  HOST,
  LEAD,
  WS,
  draft,
  report,
} from "../../engine/constellation.testing.ts";
import { attemptData, graphData } from "../data.ts";
import type { StatsHistory } from "./derive.ts";
import type { UsageResponse, UsageResponses } from "../../usage/responses.ts";

export const time = (ms: number) => new Date(Date.parse(AT) + ms).toISOString();

export const WORKER = SessionId.make("worker");

export const LEAD2 = SessionId.make("lead2");

export const statsFixture = () => {
  let sequence = 0;

  const envelope = (at: number, event: DomainEvent) =>
    EventEnvelope.make({
      sequence: Sequence.make(++sequence),
      occurredAt: time(at),
      commandId: null,
      event,
    });

  const first = Attempt.make({ ...attemptData(draft()), state: "accepted", endedAt: time(9000) });
  const second = Attempt.make({ ...attemptData(draft(B, "b1")), startedAt: time(10000) });

  const task = (id: typeof A) =>
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
    });

  const graph = Constellation.make({
    id: CID,
    workspaceId: WS,
    hostId: HOST,
    leadSessionId: LEAD2,
    name: "Telemetry",
    state: "running",
    revision: 7,
    settings: ConstellationSettings.make({}),
    tasks: [task(A), task(B)],
    attempts: [first, second],
    pendingNotifications: [],
    createdAt: AT,
    updatedAt: time(12000),
  });

  const fields = { constellationId: CID, revision: 1 };

  const started = Constellation.make({
    ...graphData(graph),
    leadSessionId: LEAD,
    attempts: [],
    revision: 0,
  });

  const events = [
    envelope(0, DomainEvent.cases.ConstellationStarted.make({ ...fields, constellation: started })),
    envelope(0, DomainEvent.cases.AttemptStarted.make({ ...fields, attempt: draft() })),
    envelope(
      1500,
      DomainEvent.cases.LeadNotified.make({
        ...fields,
        leadSessionId: LEAD,
        items: ["n1", "n2", "n3"],
        turnId: TurnId.make("digest1"),
      })
    ),
    envelope(
      5000,
      DomainEvent.cases.AttemptClaimed.make({
        ...fields,
        attemptId: first.id,
        attemptRevision: 1,
        claim: report(),
      })
    ),
    envelope(
      7000,
      DomainEvent.cases.LeadChanged.make({ ...fields, from: LEAD, to: LEAD2, summary: "continue" })
    ),
    envelope(
      9000,
      DomainEvent.cases.AttemptAccepted.make({
        ...fields,
        attemptId: first.id,
        attemptRevision: 2,
        mergedHead: "head",
        receipts: [],
        evidence: "asserted",
      })
    ),
    envelope(10000, DomainEvent.cases.AttemptStarted.make({ ...fields, attempt: second })),
    envelope(
      12000,
      DomainEvent.cases.LeadNotified.make({
        ...fields,
        leadSessionId: LEAD2,
        items: ["n4"],
        turnId: TurnId.make("digest2"),
      })
    ),
  ];

  const turn = (id: string, sessionId: SessionId, start: number, end: number | null) =>
    Turn.make({
      id: TurnId.make(id),
      sessionId,
      index: 1,
      prompt: "digest",
      attachments: [],
      model: null,
      effort: null,
      status: end === null ? "working" : "completed",
      feedback: null,
      checkpointBefore: null,
      checkpointAfter: null,
      startedAt: time(start),
      endedAt: end === null ? null : time(end),
    });

  const sessionEvents = [
    envelope(
      1000,
      DomainEvent.cases.SessionStateChanged.make({
        sessionId: WORKER,
        state: "working",
        reason: null,
      })
    ),
    envelope(
      2000,
      DomainEvent.cases.SessionStateChanged.make({ sessionId: WORKER, state: "idle", reason: null })
    ),
    envelope(
      3500,
      DomainEvent.cases.SessionStateChanged.make({
        sessionId: WORKER,
        state: "working",
        reason: null,
      })
    ),
    envelope(
      4500,
      DomainEvent.cases.SessionStateChanged.make({ sessionId: WORKER, state: "idle", reason: null })
    ),
    envelope(
      12000,
      DomainEvent.cases.SessionStateChanged.make({
        sessionId: WORKER,
        state: "working",
        reason: null,
      })
    ),
  ];

  const sessions = new Map<SessionId, ReadonlyArray<EventEnvelope>>([
    [WORKER, sessionEvents],
    [
      LEAD,
      [
        envelope(
          1000,
          DomainEvent.cases.TurnStarted.make({ turn: turn("digest1", LEAD, 1000, null) })
        ),
        envelope(
          2000,
          DomainEvent.cases.TurnEnded.make({ turn: turn("digest1", LEAD, 1000, 2000) })
        ),
      ],
    ],
    [
      LEAD2,
      [
        envelope(
          11000,
          DomainEvent.cases.TurnStarted.make({ turn: turn("digest2", LEAD2, 11000, null) })
        ),
        envelope(
          13000,
          DomainEvent.cases.TurnEnded.make({ turn: turn("digest2", LEAD2, 11000, 13000) })
        ),
      ],
    ],
  ]);

  const queue = (id: string, resource: string, at: number) =>
    envelope(
      at,
      DomainEvent.cases.ResourceLeaseQueued.make({
        hostId: HOST,
        resource,
        requestId: id,
        sessionId: WORKER,
      })
    );

  const grant = (id: string, resource: string, at: number, attemptId = first.id) =>
    envelope(
      at,
      DomainEvent.cases.ResourceLeased.make({
        lease: ResourceLease.make({
          id,
          hostId: HOST,
          resource,
          sessionId: WORKER,
          attemptId,
          processId: 1,
          command: [],
          acquiredAt: time(at),
        }),
      })
    );

  const leases = [
    queue("slot1", "__workers", 0),
    grant("slot1", "__workers", 1000),
    queue("bench1", "bench", 2500),
    queue("bench2", "bench", 3000),
    envelope(
      4000,
      DomainEvent.cases.ResourceLeaseCanceled.make({
        hostId: HOST,
        resource: "bench",
        requestId: "bench1",
        reason: "canceled",
      })
    ),
    grant("bench2", "bench", 4500),
    queue("slot2", "__workers", 10000),
    grant("slot2", "__workers", 12000, second.id),
  ];

  let responseId = 0;

  const response = (
    sessionId: SessionId,
    at: number,
    input: number,
    cost: number | null
  ): UsageResponse => {
    const tokens = TokenCounts.make({
      input,
      cacheRead: 0,
      cacheWrite: 0,
      output: 0,
      reasoning: 0,
      cacheWrite1h: 0,
    });

    return {
      id: ++responseId,
      at: time(at),
      bucket: UsageBucket.make({
        hour: AT,
        harness: "codex",
        model: "unknown-model",
        sessionId,
        tokens,
        reportedCost: cost === null ? null : ReportedCost.make({ tokens, usd: cost }),
        longContext: [],
      }),
    };
  };

  const responses: UsageResponses = {
    indexing: false,
    indexedAt: time(15000),
    responses: [
      response(LEAD, 1750, 100, 0.2),
      response(LEAD, 3000, 200, null),
      response(WORKER, 2000, 50, 0.1),
      response(WORKER, 9500, 999, null),
      response(LEAD2, 12000, 300, null),
      response(WORKER, 13000, 70, null),
    ],
  };

  const history: StatsHistory = { graph, sequence, events, sessions, leases };

  return { history, responses, envelope, first, second };
};
