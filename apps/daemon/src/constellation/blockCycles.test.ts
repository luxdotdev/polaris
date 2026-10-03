import { expect, test } from "bun:test";
import { PlanOperation, ReviewAction, SessionId, TaskDefinition, TaskId } from "@polaris/protocol";
import { Struct } from "effect";
import { decideConstellation } from "../engine/constellation.ts";
import {
  A,
  B,
  C,
  CID,
  apply,
  ctx,
  dispatched,
  draft,
  planned,
  task,
} from "../engine/constellation.testing.ts";

const X = TaskId.make("X");

const P = TaskId.make("P");

const block = (record: ReturnType<typeof planned>, id = A, on = B) => {
  const attempt = record.graph.attempts.findLast((a) => a.taskId === id)!;

  return decideConstellation(
    record,
    C.WorkerBlock.make({
      constellationId: CID,
      attemptId: attempt.id,
      on: [on],
      reason: "Wait for feed",
    }),
    ctx({ binding: { kind: "session", sessionId: attempt.sessionId } })
  );
};

const edit = (record: ReturnType<typeof planned>, id: TaskId, deps: TaskId[]) =>
  decideConstellation(
    record,
    C.Plan.make({
      constellationId: CID,
      operations: [
        PlanOperation.cases.Edit.make({
          taskId: id,
          revision: record.graph.tasks.find((t) => t.id === id)!.revision,
          task: task(id, deps),
        }),
      ],
    }),
    ctx()
  );

const waiting = (tasks = [task(A), task(B), task(X)]) => {
  let record = dispatched(planned(tasks));
  record = dispatched(record, draft(B, "b", SessionId.make("b")));

  return apply(
    record,
    C.WorkerBlock.make({
      constellationId: CID,
      attemptId: draft().id,
      on: [B],
      reason: "Feed",
    }),
    ctx({ binding: { kind: "session", sessionId: draft().sessionId } })
  );
};

test("second mutual block is rejected atomically", () => {
  const decision = block(waiting(), B, A);
  expect(decision.rejection?.findings[0]?.code).toBe("E-BLOCK-CYCLE");
  expect(decision.events).toEqual([]);
});

test("mixed dependency and block paths reject transitive blocks", () => {
  const decision = block(waiting([task(A), task(B), task(X, [A])]), B, X);
  expect(decision.rejection?.findings[0]?.code).toBe("E-BLOCK-CYCLE");
  expect(decision.events).toEqual([]);
});

test("plan edits reject live block cycles and name their block edge", () => {
  for (const deps of [[A], [X]]) {
    const decision = edit(waiting([task(A), task(B), task(X, [A])]), B, deps);
    expect(decision.rejection?.findings.find((f) => f.code === "E-DEP-CYCLE")?.message).toContain(
      "block A → B"
    );
    expect(decision.events).toEqual([]);
  }
});

test("block-closing parent edits include inherited dependencies and completion edges", () => {
  const child = new TaskDefinition(Struct.assign(task(B), { parent: P }));
  const record = waiting([task(A), task(P), child]);
  const decision = edit(record, P, [A]);
  expect(decision.rejection?.findings.find((f) => f.code === "E-DEP-CYCLE")?.message).toContain(
    "block A → B"
  );
  expect(decision.events).toEqual([]);
});

test("stopping a blocked Attempt removes its wait edges from both guards", () => {
  const record = waiting();

  const stopped = apply(
    record,
    C.Review.make({
      constellationId: CID,
      attemptId: draft().id,
      revision: record.graph.attempts[0]!.revision,
      action: ReviewAction.cases.Stop.make({ reason: "Use another approach" }),
    })
  );

  expect(block(stopped, B, A).rejection).toBeNull();
  expect(edit(stopped, B, [A]).rejection).toBeNull();
});
