import { setDefaultTimeout, test } from "bun:test";
import {
  Attempt,
  AttemptCause,
  AttemptId,
  Claim,
  Constellation,
  ConstellationId,
  ConstellationNotification,
  ConstellationSettings,
  NotificationItem,
  Task,
  TaskId,
} from "../../../protocol/src/constellation/domain.ts";
import { DomainEvent } from "../../../protocol/src/events.ts";
import { HostId, SessionId, WorkspaceId } from "../../../protocol/src/ids.ts";
import type { ConstellationTrace } from "./index.ts";
import { expectVerdicts } from "./harness.testing.ts";

const host = HostId.make("lead-host");

const lead = SessionId.make("lead");

const worker = SessionId.make("worker");

const constellationId = ConstellationId.make("graph");

const attemptId = AttemptId.make("attempt");

const E = DomainEvent.cases;

const time = "2026-10-01T00:00:00Z";

const graph = { constellationId, revision: 1 };

const target = { ...graph, attemptId, attemptRevision: 2 };

const claim = new Claim({
  branch: "polaris/graph/A",
  head: "head-1",
  commits: ["head-1"],
  receipts: [],
  notDone: [],
  followups: [],
  questions: [],
  outsideArea: [],
  decisions: [],
  summary: "Done",
});

const task = new Task({
  id: TaskId.make("A"),
  title: "A",
  brief: "Build A",
  kind: "task",
  inspect: {},
  revision: 1,
  canceled: false,
});

const initial = [
  E.ConstellationStarted.make({
    ...graph,
    constellation: new Constellation({
      id: constellationId,
      workspaceId: WorkspaceId.make("workspace"),
      hostId: host,
      leadSessionId: lead,
      name: "Graph",
      state: "planning",
      revision: 0,
      settings: new ConstellationSettings({}),
      tasks: [],
      attempts: [],
      pendingNotifications: [],
      createdAt: time,
      updatedAt: time,
    }),
  }),
  E.TaskDeclared.make({ ...graph, task }),
  E.ConstellationStateChanged.make({ ...graph, state: "running" }),
];

const began = E.AttemptStarted.make({
  ...graph,
  attempt: new Attempt({
    id: attemptId,
    taskId: task.id,
    revision: 1,
    cause: AttemptCause.cases.Initial.make({}),
    by: lead,
    sessionId: worker,
    hostId: host,
    worktree: "/temp/A",
    branch: claim.branch,
    base: "base",
    state: "working",
    claimedAt: null,
    approvedByUserAt: null,
    handedUpAt: null,
    handedUpReason: null,
    nudgedAt: null,
    startedAt: time,
  }),
});

const notification = (id: string, state: "review") =>
  E.NotificationQueued.make({
    ...graph,
    notification: new ConstellationNotification({
      id,
      queuedAt: time,
      item: NotificationItem.cases.Settled.make({ attemptId, state }),
    }),
  });

const batch = (events: ReadonlyArray<DomainEvent>) => ({ hostId: host, events });

const trace = (batches: ConstellationTrace["batches"]): ConstellationTrace => ({
  version: 1,
  ownerHostId: host,
  batches,
});

setDefaultTimeout(600_000);

test("Inspections replay against the held Claim and the verdict's routes", async () => {
  const inspection = { ...target, inspectionId: "i1", at: time };
  const claimedNow = E.AttemptClaimed.make({ ...target, claim });

  const held = [
    claimedNow,
    E.InspectionStarted.make({
      ...inspection,
      sessionId: SessionId.make("inspector"),
      head: claim.head,
      accept: false,
    }),
  ];

  const verdict = (route: "lead" | "accepted" | "sent_back") =>
    E.InspectionRecorded.make({
      ...inspection,
      verdict: route === "sent_back" ? "send_back" : "approve",
      route,
      reason: "Read it",
      mergeRefusal: null,
    });

  const superseded = E.InspectionEnded.make({
    ...inspection,
    cause: "review",
    reason: "The Lead reviewed the Claim",
  });

  const rejected = E.AttemptRejected.make({ ...target, reason: "Fix it", by: "lead" });
  const working = [batch(initial), batch([began])];

  await expectVerdicts([
    [
      "an approval that reaches the Lead",
      trace([...working, batch(held), batch([verdict("lead"), notification("n", "review")])]),
      true,
    ],
    [
      "a held Claim announced to the Lead",
      trace([...working, batch([...held, notification("n", "review")])]),
      false,
    ],
    [
      "a verdict after a review superseded the Inspection",
      trace([
        ...working,
        batch(held),
        batch([superseded, rejected]),
        batch([verdict("lead"), notification("n", "review")]),
      ]),
      false,
    ],
    [
      "an Accept the Task did not grant",
      trace([
        ...working,
        batch(held),
        batch([
          verdict("accepted"),
          E.AttemptAccepted.make({
            ...target,
            mergedHead: claim.head,
            receipts: [],
            evidence: "asserted",
          }),
        ]),
      ]),
      false,
    ],
  ]);
});
