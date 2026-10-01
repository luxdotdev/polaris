import {
  Attempt,
  AttemptCause,
  AttemptId,
  Claim,
  ConstellationCommand,
  ConstellationId,
  ConstellationSettings,
  HostId,
  PlanOperation,
  SessionId,
  TaskDefinition,
  TaskId,
  WorkspaceId,
  WorkerPlacement,
} from "@polaris/protocol";
import { decideConstellation } from "./constellation.ts";
import type { ConstellationContext } from "./constellation.inputs.ts";
import { foldConstellation, graphEvent, type ConstellationRecord } from "../store/constellation.ts";

export const AT = "2026-10-01T00:00:00.000Z";

export const CID = ConstellationId.make("c1");

export const HOST = HostId.make("host");

export const LEAD = SessionId.make("lead");

export const WS = WorkspaceId.make("ws");

export const A = TaskId.make("A");

export const B = TaskId.make("B");

export const G = TaskId.make("G");

export const C = ConstellationCommand.cases;

export const ctx = (patch: Partial<ConstellationContext> = {}): ConstellationContext => ({
  binding: { kind: "user" },
  hostId: HOST,
  now: AT,
  attempts: [],
  newLeadSessionId: null,
  claimProbe: null,
  recordedChecks: [],
  occupiedSessions: new Set(),
  offlineSessionIds: new Set(),
  commanded: false,
  resourceHolders: [],
  defaults: ConstellationSettings.make({}),
  ...patch,
});

export const task = (id = A, deps: ReadonlyArray<TaskId> = [], kind: "task" | "gate" = "task") =>
  new TaskDefinition({ id, title: id, brief: `Build ${id}`, deps: [...deps], kind });

export const draft = (
  taskId = A,
  id = "a1",
  sessionId = SessionId.make("worker"),
  cause: Attempt["cause"] = AttemptCause.cases.Initial.make({})
) =>
  new Attempt({
    id: AttemptId.make(id),
    taskId,
    revision: 0,
    cause,
    by: LEAD,
    sessionId,
    hostId: HOST,
    worktree: `/tmp/${id}`,
    branch: `polaris/${taskId}`,
    base: "base",
    state: "working",
    startedAt: AT,
  });

export const report = (branch = "polaris/A", head = "head") =>
  new Claim({
    branch,
    head,
    commits: [head],
    receipts: [],
    notDone: [],
    followups: [],
    questions: [],
    outsideArea: [],
    decisions: [],
    summary: "Implemented the task.",
  });

export const foldDecision = (
  record: ConstellationRecord | undefined,
  events: ReadonlyArray<import("@polaris/protocol").DomainEvent>
) => {
  let next = record;

  for (const event of events) {
    const graph = graphEvent(event);

    if (graph !== null) next = foldConstellation(next, graph, AT);
  }

  if (next === undefined) throw new Error("expected a constellation");

  return next;
};

export const apply = (
  record: ConstellationRecord | undefined,
  command: import("@polaris/protocol").ConstellationCommand,
  context = ctx()
) => {
  const decision = decideConstellation(record, command, context);

  if (decision.rejection !== null) throw new Error(JSON.stringify(decision.rejection.findings));

  return foldDecision(record, decision.events);
};

export const planned = (tasks = [task(A), task(B, [A]), task(G, [A, B], "gate")]) =>
  apply(
    undefined,
    C.Plan.make({
      constellationId: CID,
      start: {
        name: "Build",
        workspaceId: WS,
        leadSessionId: LEAD,
        settings: new ConstellationSettings({}),
      },
      operations: tasks.map((t) => PlanOperation.cases.Add.make({ task: t })),
    })
  );

export const dispatched = (record = planned(), attempt = draft()) =>
  apply(
    record,
    C.Dispatch.make({
      constellationId: CID,
      tasks: [
        {
          taskId: attempt.taskId,
          worker: WorkerPlacement.cases.Existing.make({ sessionId: attempt.sessionId }),
        },
      ],
    }),
    ctx({ attempts: [attempt] })
  );

export const claimed = (record = dispatched(), claim = report()) => {
  const attempt = record.graph.attempts.at(-1)!;

  return apply(
    record,
    C.WorkerClaim.make({ constellationId: CID, attemptId: attempt.id, claim }),
    ctx({
      binding: { kind: "session", sessionId: attempt.sessionId },
      claimProbe: { dirtyPaths: [], branch: claim.branch, head: claim.head },
    })
  );
};
