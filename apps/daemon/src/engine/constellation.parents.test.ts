import { expect, test } from "bun:test";
import {
  Attempt,
  AttemptCause,
  Constellation,
  PlanOperation,
  ReviewAction,
  TaskDefinition,
  TaskId,
  WorkerPlacement,
} from "@polaris/protocol";
import { decideConstellation } from "./constellation.ts";
import {
  A,
  B,
  C,
  CID,
  G,
  apply,
  claimed,
  ctx,
  dispatched,
  draft,
  planned,
  report,
  task,
} from "./constellation.testing.ts";
import { enrichProjections, projectTask } from "../constellation/projections.ts";
import { taskData, graphData, attemptData } from "../constellation/data.ts";
import {
  acceptedDependencyClaims,
  completionTasks,
  dependencyClosure,
  effectiveDeps,
} from "../constellation/parents.ts";
import { statusOutline } from "../constellation/status.ts";

const P = TaskId.make("P");

const Q = TaskId.make("Q");

const nested = (
  id: TaskId,
  parent: TaskId | null,
  deps: ReadonlyArray<TaskId> = [],
  kind: "task" | "gate" = "task"
) => new TaskDefinition({ ...taskData(task(id, deps, kind)), parent });

const add = (definition: TaskDefinition) => PlanOperation.cases.Add.make({ task: definition });

const edit = (definition: TaskDefinition, revision = 0) =>
  PlanOperation.cases.Edit.make({ taskId: definition.id, revision, task: definition });

const cancel = (taskId: TaskId, revision = 0) =>
  PlanOperation.cases.Cancel.make({ taskId, revision });

const planCommand = (operations: ReadonlyArray<typeof PlanOperation.Type>) =>
  C.Plan.make({ constellationId: CID, operations });

const codes = (
  record: ReturnType<typeof planned>,
  operations: ReadonlyArray<typeof PlanOperation.Type>
) => {
  const result = decideConstellation(record, planCommand(operations), ctx());
  expect(result.events).toEqual([]);

  return result.rejection?.findings.map((finding) => finding.code);
};

const state = (record: ReturnType<typeof planned>, id: TaskId) =>
  projectTask(
    record,
    record.graph.tasks.find((t) => t.id === id)!
  ).state;

const accept = (record: ReturnType<typeof planned>) => {
  const attempt = record.graph.attempts.at(-1)!;

  return apply(
    record,
    C.Review.make({
      constellationId: CID,
      attemptId: attempt.id,
      revision: attempt.revision,
      action: ReviewAction.cases.Accept.make({ mergedHead: "head", receipts: [] }),
    })
  );
};

test("parent validation rejects unknown parents, self and indirect cycles atomically", () => {
  const record = planned([]);
  expect(codes(record, [add(nested(A, P))])).toContain("E-PARENT-UNKNOWN");
  expect(codes(record, [add(nested(A, A))])).toContain("E-PARENT-CYCLE");
  expect(codes(record, [add(nested(A, B)), add(nested(B, A))])).toContain("E-PARENT-CYCLE");
  const valid = planned([task(P), nested(A, P), nested(B, A)]);
  expect(codes(valid, [edit(nested(P, B))])).toContain("E-PARENT-CYCLE");
});

test("Gates cannot contain children, including when an Edit turns a parent into a Gate", () => {
  expect(codes(planned([]), [add(task(P, [], "gate")), add(nested(A, P))])).toContain(
    "E-PARENT-GATE"
  );
  const record = planned([task(P), nested(A, P)]);
  expect(codes(record, [edit(task(P, [], "gate"))])).toContain("E-PARENT-GATE");
  expect(planned([task(P), nested(G, P, [], "gate")]).promoted.has(G)).toBe(true);
});

test("adding or moving a child beneath a Task with any Attempt is refused", () => {
  const record = dispatched(planned([task(A), task(B)]));
  expect(codes(record, [add(nested(P, A))])).toContain("E-PARENT-STARTED");
  expect(codes(record, [edit(nested(B, A))])).toContain("E-PARENT-STARTED");
  const done = accept(claimed(record));
  expect(codes(done, [add(nested(P, A))])).toContain("E-PARENT-STARTED");
});

test("dependencies cannot cross their own ancestry in either direction or through Edit", () => {
  expect(codes(planned([]), [add(task(P, [B])), add(nested(A, P)), add(nested(B, A))])).toContain(
    "E-DEP-ANCESTOR"
  );
  expect(codes(planned([]), [add(task(P)), add(nested(A, P)), add(nested(B, A, [P]))])).toContain(
    "E-DEP-ANCESTOR"
  );
  const record = planned([task(P), nested(A, P), task(B, [P])]);
  expect(codes(record, [edit(nested(B, A, [P]))])).toContain("E-DEP-ANCESTOR");
});

test("parents are never dispatchable and automatic dispatch starts only ready leaves", () => {
  const record = planned([task(P), nested(A, P), nested(B, P)]);

  const result = decideConstellation(
    record,
    C.Dispatch.make({
      constellationId: CID,
      tasks: [
        {
          taskId: P,
          worker: WorkerPlacement.cases.Existing.make({ sessionId: draft().sessionId }),
        },
      ],
    }),
    ctx({ attempts: [draft(P)] })
  );

  expect(result.events).toEqual([]);
  expect(result.rejection?.findings.map((f) => f.code)).toContain("E-PARENT-DISPATCH");

  const next = apply(
    record,
    C.Dispatch.make({ constellationId: CID }),
    ctx({ attempts: [draft(A), draft(B, "b", draft(B).by)] })
  );

  expect(next.graph.attempts.map((attempt) => attempt.taskId)).toEqual([A, B]);
});

test("cancellation includes every descendant in one commit, respects edits and external dependents", () => {
  const record = planned([task(P), nested(Q, P), nested(A, Q), nested(B, P), task(G, [P], "gate")]);
  expect(codes(record, [cancel(P)])).toContain("E-CANCEL-DEPENDENTS");
  const next = apply(record, planCommand([cancel(P), edit(task(B)), edit(task(G, [], "gate"))]));
  expect(next.graph.tasks.filter((t) => t.canceled).map((t) => t.id)).toEqual([P, Q, A]);
  expect(state(next, P)).toBe("canceled");
  expect(next.graph.tasks.find((t) => t.id === A)?.revision).toBe(1);
  expect(codes(next, [add(nested(TaskId.make("new"), P))])).toContain("E-CANCEL-DEPENDENTS");
});

test("canceling a parent cannot conceal an active descendant", () => {
  const record = dispatched(planned([task(P), nested(A, P)]));
  expect(codes(record, [cancel(P)])).toContain("E-TASK-ACTIVE");
  expect(record.graph.tasks.every((t) => !t.canceled)).toBe(true);
});

test("rollups include recursive work, review, done, ready and waiting with declaration-order children", () => {
  let record = planned([nested(B, Q, [A]), task(P), nested(Q, P), nested(A, Q)]);
  expect(state(record, P)).toBe("ready");
  expect(
    projectTask(
      record,
      record.graph.tasks.find((t) => t.id === Q)!
    ).children
  ).toEqual([B, A]);
  record = dispatched(record);
  expect(state(record, P)).toBe("working");
  record = claimed(record);
  expect(state(record, P)).toBe("working");
  record = accept(record);
  expect(state(record, P)).toBe("ready");
  record = dispatched(record, draft(B, "b"));
  record = accept(claimed(record, report("polaris/B")));
  expect(state(record, Q)).toBe("done");
  expect(state(record, P)).toBe("done");
  expect(enrichProjections(record, new Map()).find((p) => p.taskId === Q)?.children).toEqual([
    B,
    A,
  ]);
  const waiting = planned([task(P), nested(A, P, [B]), task(B)]);
  expect(state(waiting, P)).toBe("waiting");
});

test("a parent's working rollup excludes failed, lost and canceled descendants", () => {
  const record = dispatched(planned([task(P), nested(A, P), nested(B, P)]));

  for (const outcome of ["failed", "lost"] as const) {
    // No mutation of persisted events: model an already folded mechanical outcome.
    const observed = {
      ...record,
      graph: new Constellation({
        ...graphData(record.graph),
        attempts: [new Attempt({ ...attemptData(record.graph.attempts[0]!), state: outcome })],
      }),
    };

    expect(state(observed, P)).toBe("ready");
  }

  const canceled = apply(planned([task(P), nested(A, P), nested(B, P)]), planCommand([cancel(A)]));
  expect(state(canceled, P)).toBe("ready");
  expect(projectTask(canceled, canceled.graph.tasks[0]!).children).toEqual([A, B]);
});

test("dependencies on nested parents unblock Tasks and promote Gates exactly once", () => {
  let record = planned([task(P), nested(Q, P), nested(A, Q), nested(B, P), task(G, [P], "gate")]);
  record = accept(claimed(dispatched(record)));
  expect(state(record, P)).toBe("ready");
  expect(record.promoted.has(G)).toBe(false);
  record = accept(claimed(dispatched(record, draft(B, "b")), report("polaris/B")));
  expect(state(record, P)).toBe("done");
  expect(state(record, G)).toBe("ready");
  expect(completionTasks(record.graph.tasks, P).map((t) => t.id)).toEqual([A, B]);
  expect(acceptedDependencyClaims(record.graph, [P]).map((dep) => dep.taskId)).toEqual([A, B]);
  expect(acceptedDependencyClaims(record.graph, [P, A]).map((dep) => dep.taskId)).toEqual([A, B]);
  expect(acceptedDependencyClaims(record.graph, [A]).map((dep) => dep.taskId)).toEqual([A]);
  expect(completionTasks(record.graph.tasks, TaskId.make("unknown"))).toEqual([]);
  expect(record.promoted.has(G)).toBe(true);
  const revision = record.graph.tasks.find((t) => t.id === G)!.revision;
  const updated = apply(record, planCommand([edit(task(Q), 0)]));
  expect(updated.graph.tasks.find((t) => t.id === G)!.revision).toBe(revision);
});

test("status groups roots and prints the nested tree while Ready excludes containers", () => {
  const record = planned([
    nested(B, Q),
    new TaskDefinition({ ...taskData(task(P)), group: "Fixes" }),
    nested(Q, P),
    nested(A, P),
  ]);

  const outline = statusOutline(record);
  expect(outline).toContain("Fixes\n  P ·");
  expect(outline).toContain("\n    Q ·");
  expect(outline).toContain("\n      B ·");
  expect(outline).toContain("\n    A ·");
  expect(outline).toContain("Ready: B, A");
});

test("Edit moves Tasks between parents, and a container with only canceled children becomes a leaf", () => {
  let record = planned([task(P), task(Q), nested(A, P)]);
  record = apply(record, planCommand([edit(nested(A, Q))]));
  expect(
    projectTask(
      record,
      record.graph.tasks.find((t) => t.id === P)!
    ).children
  ).toEqual([]);
  expect(
    projectTask(
      record,
      record.graph.tasks.find((t) => t.id === Q)!
    ).children
  ).toEqual([A]);
  record = apply(record, planCommand([cancel(A, 1)]));
  record = dispatched(record, draft(Q));
  expect(state(record, Q)).toBe("working");
});

test("deep nesting has no configured depth cap and cancels the whole subtree", () => {
  const definitions = Array.from({ length: 64 }, (_, index) =>
    nested(TaskId.make(`N${index}`), index === 0 ? null : TaskId.make(`N${index - 1}`))
  );

  const record = planned(definitions.reverse());
  const root = TaskId.make("N0");
  expect(state(record, root)).toBe("ready");
  const working = dispatched(record, draft(TaskId.make("N63")));
  expect(state(working, root)).toBe("working");
  const next = apply(record, planCommand([cancel(root)]));
  expect(next.graph.tasks.every((t) => t.canceled && t.revision === 1)).toBe(true);
});

test("dependency cycles include implicit parent completion edges through unrelated Tasks", () => {
  const definitions = [task(P), nested(A, P, [B]), task(B, [P])];
  expect(codes(planned([]), definitions.map(add))).toContain("E-DEP-CYCLE");
});

const X = TaskId.make("X");

const namedDispatch = (taskId: TaskId) =>
  C.Dispatch.make({
    constellationId: CID,
    tasks: [
      {
        taskId,
        worker: WorkerPlacement.cases.Existing.make({ sessionId: draft(taskId).sessionId }),
      },
    ],
  });

test("two levels inherit dependencies for readiness, dispatch, Gate promotion and accepted Claims", () => {
  let record = planned([
    task(X),
    task(P, [X]),
    nested(Q, P),
    nested(A, Q),
    nested(G, Q, [], "gate"),
  ]);

  expect(effectiveDeps(record.graph.tasks, A)).toEqual([X]);

  for (const id of [P, Q, A, G]) {
    expect(state(record, id)).toBe("waiting");
    expect(
      projectTask(
        record,
        record.graph.tasks.find((t) => t.id === id)!
      ).blockedBy
    ).toEqual([X]);
  }

  expect(record.promoted.has(G)).toBe(false);
  const denied = decideConstellation(record, namedDispatch(A), ctx({ attempts: [draft(A)] }));
  expect(denied.rejection?.findings.map((f) => f.code)).toContain("E-NOT-READY");

  const auto = apply(
    record,
    C.Dispatch.make({ constellationId: CID }),
    ctx({ attempts: [draft(X)] })
  );

  expect(auto.graph.attempts.map((a) => a.taskId)).toEqual([X]);
  record = accept(claimed(auto, report("polaris/X")));
  expect(state(record, A)).toBe("ready");
  expect(state(record, P)).toBe("ready");
  expect(record.promoted.has(G)).toBe(true);
  expect(
    acceptedDependencyClaims(record.graph, effectiveDeps(record.graph.tasks, A)).map(
      (d) => d.taskId
    )
  ).toEqual([X]);
  const edited = apply(record, planCommand([edit(nested(A, Q, [X]))]));
  expect(effectiveDeps(edited.graph.tasks, A)).toEqual([X]);
});

test("an Edit of an existing parent gates idle descendants but preserves active rollup", () => {
  let record = planned([task(P), nested(Q, P), nested(A, Q), nested(B, Q), task(X)]);
  record = dispatched(record);
  record = apply(record, planCommand([edit(task(P, [X]))]));
  expect(state(record, P)).toBe("working");
  expect(state(record, Q)).toBe("working");
  expect(state(record, B)).toBe("waiting");
  record = accept(claimed(record));
  expect(state(record, A)).toBe("done");
  expect(state(record, P)).toBe("waiting");
  expect(state(record, Q)).toBe("waiting");
  record = apply(record, planCommand([cancel(B), add(task(G, [Q], "gate"))]));
  expect(state(record, P)).toBe("waiting");
  expect(record.promoted.has(G)).toBe(false);
  record = accept(claimed(dispatched(record, draft(X, "x")), report("polaris/X")));
  expect(state(record, P)).toBe("done");
  expect(record.promoted.has(G)).toBe(true);
});

test("named retries cannot bypass newly inherited prerequisites", () => {
  let record = dispatched(planned([task(P), nested(Q, P), nested(A, Q), task(X)]));
  const attempt = record.graph.attempts[0]!;
  record = apply(
    record,
    C.Review.make({
      constellationId: CID,
      attemptId: attempt.id,
      revision: attempt.revision,
      action: ReviewAction.cases.Stop.make({ reason: "retry later" }),
    })
  );
  record = apply(record, planCommand([edit(task(P, [X]))]));

  const retry = draft(
    A,
    "retry",
    attempt.sessionId,
    AttemptCause.cases.Recover.make({ ref: attempt.id })
  );

  const denied = decideConstellation(record, namedDispatch(A), ctx({ attempts: [retry] }));
  expect(denied.events).toEqual([]);
  expect(denied.rejection?.findings.map((f) => f.code)).toContain("E-NOT-READY");
  record = accept(claimed(dispatched(record, draft(X, "x")), report("polaris/X")));
  expect(
    apply(record, namedDispatch(A), ctx({ attempts: [retry] })).graph.attempts.at(-1)?.taskId
  ).toBe(A);
});

test("parent dependency edits reject inherited ancestry and completion cycles atomically", () => {
  const record = planned([task(P), nested(Q, P), nested(A, Q), task(X, [A])]);
  expect(codes(record, [edit(task(P, [Q]))])).toContain("E-DEP-ANCESTOR");
  expect(codes(record, [edit(task(P, [X]))])).toContain("E-DEP-CYCLE");
  expect(state(record, A)).toBe("ready");
});

test("effective dependencies union own, parent and grandparent prerequisites without duplicates", () => {
  const record = planned([
    task(X),
    task(B),
    task(G),
    task(P, [X]),
    nested(Q, P, [B]),
    nested(A, Q, [G, B]),
  ]);

  expect(effectiveDeps(record.graph.tasks, A)).toEqual([G, B, X]);
  expect(dependencyClosure(record.graph.tasks, P)).toEqual(new Set([Q, A, G, B, X]));
  expect(
    projectTask(
      record,
      record.graph.tasks.find((t) => t.id === A)!
    ).blockedBy
  ).toEqual([G, B, X]);
});
