import {
  Attempt,
  AttemptCause,
  AttemptId,
  CheckReceipt,
  Claim,
  Constellation,
  ConstellationId,
  ConstellationQuestion,
  ConstellationSettings,
  HarnessSelection,
  HostId,
  ModelId,
  SessionId,
  Task,
  TaskDefinition,
  TaskId,
  TaskProjection,
  TurnId,
  WorkerActivity,
  WorkerLiveness,
  WorkspaceId,
} from "@polaris/protocol";
import { expect, test } from "bun:test";
import { constellationView, type GroupRow, type TaskRow } from "./model.ts";

const NOW = Date.parse("2026-10-27T12:00:00Z");

const task = (id: string, title: string, extra: Partial<TaskDefinition> = {}): Task =>
  new Task({
    id: TaskId.make(id),
    title,
    kind: "task",
    brief: "",
    deps: [],
    area: [],
    criteria: [],
    suggested: null,
    group: null,
    parent: null,
    ...extra,
    revision: 0,
    canceled: false,
  });

const attempt = (taskId: string, extra: Partial<Attempt> = {}): Attempt =>
  new Attempt({
    id: AttemptId.make(`${taskId}-a1`),
    taskId: TaskId.make(taskId),
    revision: 4,
    cause: AttemptCause.cases.Initial.make({}),
    by: SessionId.make("lead"),
    sessionId: SessionId.make(`${taskId}-worker`),
    hostId: HostId.make("mac"),
    worktree: `/w/${taskId}`,
    branch: taskId,
    base: "main",
    state: "working",
    claimedAt: null,
    approvedByUserAt: null,
    handedUpAt: null,
    handedUpReason: null,
    nudgedAt: null,
    startedAt: "2026-10-27T11:30:00Z",
    ...extra,
  });

const projection = (
  taskId: string,
  state: TaskProjection["state"],
  extra: Partial<TaskProjection> = {}
): TaskProjection =>
  new TaskProjection({
    taskId: TaskId.make(taskId),
    state,
    latestAttemptId:
      state === "waiting" || state === "ready" ? null : AttemptId.make(`${taskId}-a1`),
    blockedBy: [],
    gatePromoted: false,
    stale: false,
    branchFetched: true,
    liveness: null,
    ...extra,
  });

const reported = (label: string, exitCode: number | null = null) =>
  CheckReceipt.cases.Reported.make({ label, text: "ran", exitCode });

const claim = (
  receipts: ReadonlyArray<CheckReceipt>,
  questions: ReadonlyArray<ConstellationQuestion> = []
) =>
  new Claim({
    branch: "b2",
    head: "3f9c2e1a0b",
    commits: [],
    receipts,
    notDone: [],
    followups: [],
    questions,
    outsideArea: [],
    decisions: [],
    summary: "",
  });

const ask = new ConstellationQuestion({
  id: "q1",
  to: "user",
  text: "Should the chip row scroll, or wrap to two lines past four workspaces?",
  blocking: true,
});

/** Paper C2's graph: A finished, B1 working, B2 handed to the user, B3 waiting, G2 the gate. */
const c2 = (b2: Partial<Attempt> = {}, parent: TaskId | null = null) => {
  const inB = { group: "B · Home on midnight", parent };

  const tasks = [
    ...(parent === null ? [] : [task(parent, "Home", { group: "B · Home on midnight" })]),
    task("A1", "Tokens", { group: "A · Midnight tokens" }),
    task("A2", "Type scale", { group: "A · Midnight tokens" }),
    task("A3", "Drift test", { group: "A · Midnight tokens" }),
    task("B1", "Horizon scene", {
      ...inB,
      suggested: new HarnessSelection({ harness: "claude", model: ModelId.make("opus 5") }),
    }),
    task("B2", "Workspace chips", inB),
    task("B3", "Tab bar on midnight", {
      ...inB,
      deps: [TaskId.make("B1")],
    }),
    task("G2", "Home merged", {
      kind: "gate",
      deps: ["B1", "B2", "B3"].map((id) => TaskId.make(id)),
    }),
  ];

  const attempts = [
    attempt("B1"),
    attempt("B2", {
      state: "review",
      handedUpAt: "2026-10-27T11:58:00Z",
      claim: claim([reported("tests", 0), reported("lint", 0)], [ask]),
      ...b2,
    }),
  ];

  const projections = [
    ...(parent === null ? [] : [projection(parent, "working")]),
    projection("A1", "done"),
    projection("A2", "done"),
    projection("A3", "done"),
    projection("B1", "working", {
      liveness: new WorkerLiveness({
        current: new WorkerActivity({
          itemId: "i1",
          turnId: TurnId.make("t1"),
          command: "bun run bench",
          startedAt: NOW - 4 * 60_000,
        }),
        lastOutputAt: null,
        contextPercent: null,
        queuedInput: 0,
      }),
    }),
    projection("B2", "review"),
    projection("B3", "waiting", { blockedBy: [TaskId.make("B1")] }),
    projection("G2", "waiting", { blockedBy: ["B1", "B2", "B3"].map((id) => TaskId.make(id)) }),
  ];

  const constellation = new Constellation({
    id: ConstellationId.make("c"),
    workspaceId: WorkspaceId.make("w"),
    hostId: HostId.make("mac"),
    leadSessionId: SessionId.make("lead"),
    name: "Orchestrator overhaul",
    state: "running",
    revision: 9,
    settings: new ConstellationSettings({}),
    tasks,
    attempts,
    pendingNotifications: [],
    createdAt: "2026-10-27T10:00:00Z",
    updatedAt: "2026-10-27T11:58:00Z",
  });

  return { constellation, projections };
};

const tasks = (rows: ReadonlyArray<GroupRow | TaskRow>) =>
  new Map(rows.flatMap((r) => (r.kind === "task" ? [[r.id, r] as const] : [])));

test("C2: the task bar counts done tasks and has a segment per task", () => {
  const view = constellationView(c2(), NOW);

  expect(view.bar).toMatchObject({ done: 3, total: 7 });
  expect(view.bar.segments).toEqual([
    "done",
    "done",
    "done",
    "working",
    "needs-you",
    "waiting",
    "waiting",
  ]);
});

test("C2: a finished group folds; one with work left stays open with its counts", () => {
  const view = constellationView(c2(), NOW);
  const groups = view.rows.filter((r): r is GroupRow => r.kind === "group");

  expect(groups.map((g) => [g.name, g.open, g.finished])).toEqual([
    ["A · Midnight tokens", false, true],
    ["B · Home on midnight", true, false],
  ]);
  expect(groups[1]).toMatchObject({ needsYou: 1, working: 1 });
  expect(tasks(view.rows).has("A1")).toBe(false);
  // Opening the finished group shows its tasks.
  expect(
    tasks(constellationView(c2(), NOW, new Map([["A · Midnight tokens", true]])).rows).has("A1")
  ).toBe(true);
});

test("C2: the working attempt shows its live command and how long it has run", () => {
  const b1 = tasks(constellationView(c2(), NOW).rows).get("B1");

  expect(b1?.second).toEqual({ kind: "activity", command: "bun run bench", elapsed: "4m" });
  expect(b1?.worker).toBe("claude · opus 5");
});

test("C2: a claim the lead handed up shows its checks and question, and needs you", () => {
  const b2 = tasks(constellationView(c2(), NOW).rows).get("B2");

  expect(b2).toMatchObject({ tone: "needs-you", word: "handed to you" });
  expect(b2?.handed).toEqual({
    attemptId: "B2-a1",
    revision: 4,
    head: "3f9c2e1",
    checks: [
      { label: "tests", result: "passed" },
      { label: "lint", result: "passed" },
    ],
    question: ask.text,
    reason: null,
  });
});

test("once the user approved, the claim is the lead's again: in review, no actions", () => {
  const b2 = tasks(
    constellationView(c2({ approvedByUserAt: "2026-10-27T11:59:00Z" }), NOW).rows
  ).get("B2");

  expect(b2).toMatchObject({ tone: "review", word: "in review", handed: null });
});

test("a failing check reads as failed, a check without an exit code as reported", () => {
  const b2 = tasks(
    constellationView(
      c2({
        claim: claim([reported("tests", 1), reported("bench")]),
      }),
      NOW
    ).rows
  ).get("B2");

  expect(b2?.handed?.checks.map((c) => c.result)).toEqual(["failed", "reported"]);
  expect(b2?.handed?.question).toBeNull();
});

test("C2: a waiting task says what it waits on; the gate is the lead's", () => {
  const rows = tasks(constellationView(c2(), NOW).rows);

  expect(rows.get("B3")?.second).toEqual({ kind: "after", ids: "B1" });
  expect(rows.get("G2")).toMatchObject({
    gate: true,
    word: "lead",
    second: { kind: "after", ids: "B1–B3" },
    deps: ["working", "needs-you", "waiting"],
  });
});

test("a parent task is a container: its children have rows, it has none", () => {
  const view = constellationView(c2({}, TaskId.make("B")), NOW);

  expect(view.bar.total).toBe(7);
  expect(tasks(view.rows).has("B")).toBe(false);
  expect(tasks(view.rows).has("B1")).toBe(true);
});
