import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AttemptId,
  ConstellationCommand,
  PlanOperation,
  ReviewAction,
  SessionId,
  SetConstellationStateAction,
  WorkerPlacement,
  type DomainEvent,
} from "@polaris/protocol";
import fc from "fast-check";
import { decideConstellation } from "../engine/constellation.ts";
import {
  A,
  B,
  C,
  CID,
  HOST,
  LEAD,
  ctx,
  draft,
  foldDecision,
  planned,
  report,
  task,
} from "../engine/constellation.testing.ts";
import { type ConstellationContext } from "../engine/constellation.inputs.ts";
import { type ConstellationRecord } from "../store/constellation.ts";
import {
  emptyReference,
  foldReference,
  latest,
  observeFold,
  observeReference,
  type Reference,
} from "./constellation.reference.testing.ts";
import { pbtRuns, pbtSeed } from "./pbt.ts";

interface Step {
  command: ConstellationCommand;
  context: ConstellationContext;
  allowed: boolean;
}

const active = (state: string | undefined) => state === "working" || state === "review";

const metadataStep = (ref: Reference, op: number): Step => {
  const attempt = latest(ref, op % 2 === 0 ? A : B);
  const approve = Math.floor(op / 2) === 8;
  const authorized = op % 2 === 0;

  return {
    command: C.Review.make({
      constellationId: CID,
      attemptId: AttemptId.make(attempt?.id ?? "missing"),
      revision: attempt?.revision ?? 0,
      action: approve
        ? ReviewAction.cases.Approve.make({})
        : ReviewAction.cases.HandUp.make({ reason: "Choose" }),
    }),
    context: ctx({
      binding: (approve ? authorized : !authorized)
        ? { kind: "user" }
        : { kind: "session", sessionId: LEAD },
    }),
    allowed:
      (ref.state === "planning" || ref.state === "running" || ref.state === "paused") &&
      attempt?.state === "review" &&
      authorized,
  };
};

const step = (ref: Reference, op: number, index: number): Step => {
  const taskId = op % 2 === 0 ? A : B;
  const attempt = latest(ref, taskId);
  const attemptId = AttemptId.make(attempt?.id ?? "missing");
  const sessionId = SessionId.make(`worker-${taskId}`);
  const mutable = ref.state === "planning" || ref.state === "running" || ref.state === "paused";
  const action = Math.floor(op / 2);
  const base = { constellationId: CID, attemptId };
  const workerContext = ctx({ binding: { kind: "session", sessionId } });

  if (action === 0)
    return {
      command: C.Dispatch.make({
        constellationId: CID,
        tasks: [{ taskId, worker: WorkerPlacement.cases.Existing.make({ sessionId }) }],
      }),
      context: ctx({ attempts: [draft(taskId, `a-${index}`, sessionId)] }),
      allowed: (ref.state === "planning" || ref.state === "running") && attempt === undefined,
    };

  if (action === 1)
    return {
      command: C.WorkerProgress.make({ ...base, note: "progress" }),
      context: workerContext,
      allowed: mutable && active(attempt?.state),
    };

  if (action === 2)
    return {
      command: C.WorkerClaim.make({ ...base, claim: report(`polaris/${taskId}`) }),
      context: ctx({
        ...workerContext,
        claimProbe: { dirtyPaths: [], branch: `polaris/${taskId}`, head: "head" },
      }),
      allowed: mutable && attempt?.state === "working",
    };

  if (action === 3)
    return {
      command: C.Review.make({
        ...base,
        revision: attempt?.revision ?? 0,
        action: ReviewAction.cases.Accept.make({ mergedHead: "head", receipts: [] }),
      }),
      context: ctx(),
      allowed: mutable && attempt?.state === "review",
    };

  if (action === 4)
    return {
      command: C.Review.make({
        ...base,
        revision: attempt?.revision ?? 0,
        action: ReviewAction.cases.SendBack.make({
          reason: "fix",
          worker: WorkerPlacement.cases.Existing.make({ sessionId }),
        }),
      }),
      context: ctx({ attempts: [draft(taskId, `retry-${index}`, sessionId)] }),
      allowed: mutable && attempt?.state === "review",
    };

  if (action === 5)
    return {
      command: C.Review.make({
        ...base,
        revision: (attempt?.revision ?? 0) + 1,
        action: ReviewAction.cases.Stop.make({ reason: "stale command" }),
      }),
      context: ctx(),
      allowed: false,
    };

  if (action === 6)
    return {
      command: C.SetState.make({
        constellationId: CID,
        action: SetConstellationStateAction.cases.Pause.make({}),
      }),
      context: ctx(),
      allowed: ref.state === "running",
    };

  if (action >= 8) return metadataStep(ref, op);

  return {
    command: C.SetState.make({
      constellationId: CID,
      action: SetConstellationStateAction.cases.Resume.make({}),
    }),
    context: ctx(),
    allowed: ref.state === "planning" || ref.state === "paused",
  };
};

let traceIndex = 0;

const run = (operations: ReadonlyArray<number>) => {
  const start = C.Plan.make({
    constellationId: CID,
    start: {
      name: "model",
      workspaceId: planned().graph.workspaceId,
      leadSessionId: planned().graph.leadSessionId,
      settings: planned().graph.settings,
    },
    operations: [task(A), task(B)].map((t) => PlanOperation.cases.Add.make({ task: t })),
  });

  const first = decideConstellation(undefined, start, ctx());
  let record: ConstellationRecord = foldDecision(undefined, first.events);
  const ref = emptyReference();
  foldReference(ref, first.events);

  const batches: Array<{ hostId: string; events: ReadonlyArray<DomainEvent> }> = [
    { hostId: HOST, events: first.events },
  ];

  for (const [index, op] of operations.entries()) {
    const input = step(ref, op, index);
    const decision = decideConstellation(record, input.command, input.context);
    expect(decision.rejection === null).toBe(input.allowed);

    if (!input.allowed) expect(decision.events).toEqual([]);
    else {
      record = foldDecision(record, decision.events);
      foldReference(ref, decision.events);

      if (decision.events.length > 0) batches.push({ hostId: HOST, events: decision.events });
    }

    expect(observeFold(record)).toEqual(observeReference(ref));
    const sessions = record.graph.attempts.filter((a) => active(a.state)).map((a) => a.sessionId);
    expect(new Set(sessions).size).toBe(sessions.length);
  }

  if (process.env.POLARIS_TRACE_DIR !== undefined) {
    mkdirSync(process.env.POLARIS_TRACE_DIR, { recursive: true });
    writeFileSync(
      join(process.env.POLARIS_TRACE_DIR, `constellation-${traceIndex++}.json`),
      JSON.stringify({ version: 1, ownerHostId: HOST, batches })
    );
  }
};

test("model sequences compare the real decider and fold with independent command guards and reference fold", () => {
  fc.assert(
    fc.property(fc.array(fc.integer({ min: 0, max: 19 }), { minLength: 20, maxLength: 100 }), run),
    { numRuns: pbtRuns(100), ...pbtSeed() }
  );
});
