import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AttemptCause,
  AttemptId,
  PlanOperation,
  ReviewAction,
  SessionId,
  TaskDefinition,
  TaskId,
  WorkerPlacement,
  type DomainEvent,
} from "@polaris/protocol";
import { Predicate } from "effect";
import fc from "fast-check";
import { taskData } from "../constellation/data.ts";
import { decideConstellationJournal } from "../constellation/journal.ts";
import { type ConstellationContext } from "../engine/constellation.inputs.ts";
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
import { graphEvent, type ConstellationRecord } from "../store/constellation.ts";
import {
  emptyReference,
  foldReference,
  latest,
  observeFold,
  observeReference,
  type RefAttempt,
  type RefInspection,
  type Reference,
} from "./constellation.reference.testing.ts";
import { pbtRuns, pbtSeed, pbtTimeout } from "./pbt.ts";

const X = TaskId.make("X");

/** A is marked for Inspection, B is marked with the Accept grant, X is not marked. */
const MARKS: ReadonlyArray<readonly [TaskId, { accept?: boolean } | null]> = [
  [A, {}],
  [B, { accept: true }],
  [X, null],
];

const worker = (taskId: TaskId) => SessionId.make(`worker-${taskId}`);

/** What a step must do: refuse with a code, or commit and tell the Lead `heard` (null: nothing). */
interface Expected {
  readonly code: string | null;
  readonly heard: "review" | "accepted" | "rejected" | null;
  readonly attempt: RefAttempt["state"] | null;
  readonly inspection: RefInspection["state"] | null;
  /** A send-back's next Attempt, started for the same worker. */
  readonly next: boolean;
}

const refused = (code: string): Expected => ({
  code,
  heard: null,
  attempt: null,
  inspection: null,
  next: false,
});

interface Step {
  readonly decide: (record: ConstellationRecord) => {
    readonly events: ReadonlyArray<DomainEvent>;
    readonly rejection: { readonly findings: ReadonlyArray<{ readonly code: string }> } | null;
  };
  readonly taskId: TaskId;
  readonly expected: Expected;
}

/** The Inspections a Task has had, oldest first: the reference keeps only the current one. */
type Seen = Map<TaskId, Array<{ attemptId: string; inspection: RefInspection }>>;

const holding = (attempt: RefAttempt | undefined) =>
  attempt?.state === "review" && attempt.inspection?.state === "pending";

const verdict =
  (
    attempt: { readonly attemptId: string; readonly inspectionId: string },
    kind: "approve" | "send_back",
    context: ConstellationContext
  ) =>
  (record: ConstellationRecord) =>
    decideConstellation(
      record,
      C.Inspect.make({
        constellationId: CID,
        attemptId: AttemptId.make(attempt.attemptId),
        inspectionId: attempt.inspectionId,
        verdict: kind,
        reason: "Reads right.",
      }),
      context
    );

/** A verdict from the Inspection the Task's latest Attempt carries, whatever its state. */
const ownVerdict = (ref: Reference, taskId: TaskId, action: number, index: number): Step => {
  const attempt = latest(ref, taskId);
  const inspection = attempt?.inspection ?? null;
  const kind = action === 4 ? "send_back" : "approve";
  const merged = action === 2;

  const context = ctx({
    binding: {
      kind: "session",
      sessionId: SessionId.make(inspection?.sessionId ?? "nobody"),
    },
    inspectorMerge: kind === "approve" ? { refusal: merged ? null : "The merge conflicts" } : null,
    attempts:
      kind === "send_back" && attempt !== undefined
        ? [
            draft(
              taskId,
              `retry-${index}`,
              worker(taskId),
              AttemptCause.cases.SentBack.make({ ref: AttemptId.make(attempt.id) })
            ),
          ]
        : [],
  });

  const decide = verdict(
    { attemptId: attempt?.id ?? "missing", inspectionId: inspection?.id ?? "none" },
    kind,
    context
  );

  if (inspection === null) return { decide, taskId, expected: refused("E-AUTHORITY") };

  if (!holding(attempt)) return { decide, taskId, expected: refused("E-INSPECTION-STALE") };

  if (kind === "send_back")
    return {
      decide,
      taskId,
      expected: {
        code: null,
        heard: "rejected",
        attempt: "rejected",
        inspection: "sent_back",
        next: true,
      },
    };

  const accepts = inspection.accept && merged;

  return {
    decide,
    taskId,
    expected: {
      code: null,
      heard: accepts ? "accepted" : "review",
      attempt: accepts ? "accepted" : "review",
      inspection: accepts ? "accepted" : "approved",
      next: false,
    },
  };
};

/** A verdict from an Inspection a newer Claim or Attempt replaced, or from another session. */
const foreignVerdict = (ref: Reference, seen: Seen, taskId: TaskId, action: number): Step => {
  const attempt = latest(ref, taskId);
  const history = seen.get(taskId) ?? [];
  const old = history.find((h) => h.inspection.id !== attempt?.inspection?.id);
  const current = attempt?.inspection ?? null;

  if (action === 5 && old !== undefined)
    return {
      decide: verdict(
        { attemptId: old.attemptId, inspectionId: old.inspection.id },
        "approve",
        ctx({
          binding: { kind: "session", sessionId: SessionId.make(old.inspection.sessionId) },
          inspectorMerge: { refusal: null },
        })
      ),
      taskId,
      // A newer Claim gave its Attempt another Inspection, or that Attempt left review.
      expected: refused(
        ref.attempts.get(old.attemptId)?.inspection?.id === old.inspection.id
          ? "E-INSPECTION-STALE"
          : "E-AUTHORITY"
      ),
    };

  return {
    decide: verdict(
      { attemptId: attempt?.id ?? "missing", inspectionId: current?.id ?? "none" },
      "approve",
      ctx({
        binding: { kind: "session", sessionId: action === 5 ? LEAD : worker(taskId) },
        inspectorMerge: { refusal: null },
      })
    ),
    taskId,
    expected: refused("E-AUTHORITY"),
  };
};

const leadReview = (ref: Reference, taskId: TaskId, action: number, index: number): Step => {
  const attempt = latest(ref, taskId);
  const base = { constellationId: CID, attemptId: AttemptId.make(attempt?.id ?? "missing") };
  const superseded = holding(attempt) ? "superseded" : (attempt?.inspection?.state ?? null);

  if (action === 7)
    return {
      decide: (record) =>
        decideConstellation(
          record,
          C.Review.make({
            ...base,
            revision: attempt?.revision ?? 0,
            action: ReviewAction.cases.SendBack.make({
              reason: `fix ${index}`,
              worker: WorkerPlacement.cases.Existing.make({ sessionId: worker(taskId) }),
            }),
          }),
          ctx({ attempts: [draft(taskId, `retry-${index}`, worker(taskId))] })
        ),
      taskId,
      expected:
        attempt?.state === "review"
          ? {
              code: null,
              heard: "rejected",
              attempt: "rejected",
              inspection: superseded,
              next: true,
            }
          : refused("any"),
    };

  return {
    decide: (record) =>
      decideConstellation(
        record,
        C.Review.make({
          ...base,
          // The Lead accepts the Claim it was told of; Inspection events since do not stale it.
          revision: attempt?.claimRevision ?? attempt?.revision ?? 0,
          action: ReviewAction.cases.Accept.make({
            mergedHead: attempt?.head ?? "head",
            receipts: [],
          }),
        }),
        ctx()
      ),
    taskId,
    expected:
      attempt?.state === "review"
        ? {
            code: null,
            heard: "accepted",
            attempt: "accepted",
            inspection: superseded,
            next: false,
          }
        : refused("any"),
  };
};

const lost = (ref: Reference, taskId: TaskId): Step => {
  const attempt = latest(ref, taskId);

  return {
    decide: (record) =>
      decideConstellationJournal(
        record,
        {
          type: "inspectionLost",
          attemptId: AttemptId.make(attempt?.id ?? "missing"),
          inspectionId: attempt?.inspection?.id ?? "none",
          reason: "its Turn ended without a verdict",
        },
        ctx()
      ),
    taskId,
    expected: {
      code: null,
      heard: holding(attempt) ? "review" : null,
      attempt: attempt?.state ?? null,
      inspection: holding(attempt) ? "lost" : (attempt?.inspection?.state ?? null),
      next: false,
    },
  };
};

const claim = (ref: Reference, taskId: TaskId, index: number): Step => {
  const attempt = latest(ref, taskId);
  const head = index % 2 === 0 ? "head" : "revised-head";
  const marked = MARKS.find(([id]) => id === taskId)![1] !== null;

  const allowed =
    (attempt?.state === "working" || (attempt?.state === "review" && attempt.head !== head)) &&
    ![...ref.attempts.values()].some(
      (a) =>
        a.taskId === taskId && a.id !== attempt?.id && a.state === "rejected" && a.head === head
    );

  return {
    decide: (record) =>
      decideConstellation(
        record,
        C.WorkerClaim.make({
          constellationId: CID,
          attemptId: AttemptId.make(attempt?.id ?? "missing"),
          claim: report(`polaris/${taskId}`, head),
        }),
        ctx({
          binding: { kind: "session", sessionId: worker(taskId) },
          claimProbe: { dirtyPaths: [], branch: `polaris/${taskId}`, head },
        })
      ),
    taskId,
    expected: allowed
      ? {
          code: null,
          // A marked Task's Claim is held: the Lead hears nothing until the verdict.
          heard: marked ? null : "review",
          attempt: "review",
          inspection: marked ? "pending" : null,
          next: false,
        }
      : refused("any"),
  };
};

const dispatch = (ref: Reference, taskId: TaskId, index: number): Step => ({
  decide: (record) =>
    decideConstellation(
      record,
      C.Dispatch.make({
        constellationId: CID,
        tasks: [
          { taskId, worker: WorkerPlacement.cases.Existing.make({ sessionId: worker(taskId) }) },
        ],
      }),
      ctx({ attempts: [draft(taskId, `a-${index}`, worker(taskId))] })
    ),
  taskId,
  expected:
    latest(ref, taskId) === undefined
      ? { code: null, heard: null, attempt: "working", inspection: null, next: false }
      : refused("any"),
});

const step = (ref: Reference, seen: Seen, op: number, index: number): Step => {
  const taskId = MARKS[op % 3]![0];
  const action = Math.floor(op / 3);

  if (action === 0) return dispatch(ref, taskId, index);

  if (action === 1) return claim(ref, taskId, index);

  if (action <= 4) return ownVerdict(ref, taskId, action, index);

  if (action <= 6) return foreignVerdict(ref, seen, taskId, action);

  if (action <= 8) return leadReview(ref, taskId, action, index);

  return lost(ref, taskId);
};

/** The settles a decision queued for the Lead, by the state they announce. */
const heard = (events: ReadonlyArray<DomainEvent>) =>
  events.flatMap((domain) => {
    const event = graphEvent(domain);

    return event !== null &&
      Predicate.isTagged(event, "NotificationQueued") &&
      Predicate.isTagged(event.notification.item, "Settled")
      ? [event.notification.item.state]
      : [];
  });

/** Checks the Attempt a step acted on and the one a send-back started; returns the first. */
const outcome = (ref: Reference, input: Step, before: RefAttempt | undefined, label: string) => {
  const acted = before === undefined ? latest(ref, input.taskId) : ref.attempts.get(before.id);
  const current = latest(ref, input.taskId);

  expect(acted?.state ?? null, label).toBe(input.expected.attempt);
  expect(acted?.inspection?.state ?? null, label).toBe(input.expected.inspection);
  expect(current?.id !== acted?.id, label).toBe(input.expected.next);

  if (input.expected.next)
    expect(current, label).toMatchObject({
      state: "working",
      sessionId: worker(input.taskId),
      inspection: null,
    });

  // An Inspector holds no Attempt and is never the worker of one.
  for (const attempt of ref.attempts.values())
    expect(attempt.sessionId, label).not.toBe(attempt.inspection?.sessionId ?? "");

  return acted;
};

const remember = (seen: Seen, taskId: TaskId, current: RefAttempt | undefined) => {
  const inspection = current?.inspection;
  const history = seen.get(taskId) ?? [];

  if (inspection == null || current === undefined) return;

  if (!history.some((h) => h.inspection.id === inspection.id))
    seen.set(taskId, [...history, { attemptId: current.id, inspection }]);
};

let traceIndex = 0;

const run = (operations: ReadonlyArray<number>) => {
  const start = C.Plan.make({
    constellationId: CID,
    start: {
      name: "inspection",
      workspaceId: planned().graph.workspaceId,
      leadSessionId: planned().graph.leadSessionId,
      settings: planned().graph.settings,
    },
    operations: MARKS.map(([id, inspect]) =>
      PlanOperation.cases.Add.make({
        task: new TaskDefinition({ ...taskData(task(id)), inspect }),
      })
    ),
  });

  const first = decideConstellation(undefined, start, ctx());
  let record: ConstellationRecord = foldDecision(undefined, first.events);
  const ref = emptyReference();
  foldReference(ref, first.events);
  const seen: Seen = new Map();
  const batches = [{ hostId: String(HOST), events: first.events }];
  const routes: Array<string> = [];

  for (const [index, op] of operations.entries()) {
    const input = step(ref, seen, op, index);
    const before = latest(ref, input.taskId);
    const decision = input.decide(record);
    const codes = decision.rejection?.findings.map((f) => f.code) ?? [];
    const label = JSON.stringify({ op, index, codes });

    if (input.expected.code !== null) {
      expect(decision.rejection, label).not.toBeNull();
      expect(decision.events, label).toEqual([]);

      if (input.expected.code !== "any") expect(codes, label).toEqual([input.expected.code]);
      continue;
    }

    expect(codes, label).toEqual([]);
    record = foldDecision(record, decision.events);
    foldReference(ref, decision.events);

    if (decision.events.length > 0) batches.push({ hostId: HOST, events: decision.events });

    expect(observeFold(record), label).toEqual(observeReference(ref));
    expect(heard(decision.events), label).toEqual(
      input.expected.heard === null ? [] : [input.expected.heard]
    );

    const acted = outcome(ref, input, before, label);

    remember(seen, input.taskId, latest(ref, input.taskId));

    if (acted?.inspection != null && acted.inspection.state !== "pending")
      routes.push(acted.inspection.state);
  }

  if (process.env.POLARIS_TRACE_DIR !== undefined) {
    mkdirSync(process.env.POLARIS_TRACE_DIR, { recursive: true });
    writeFileSync(
      join(process.env.POLARIS_TRACE_DIR, `constellation-inspection-${traceIndex++}.json`),
      JSON.stringify({ version: 1, ownerHostId: HOST, batches })
    );
  }

  return new Set(routes);
};

const RUNS = pbtRuns(100);

test(
  "Inspection sequences: the real decider and fold agree with independent guards, routes and what the Lead hears",
  () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 29 }), { minLength: 20, maxLength: 80 }),
        (operations) => {
          run(operations);
        }
      ),
      { numRuns: RUNS, ...pbtSeed() }
    );
  },
  pbtTimeout(RUNS, 100)
);

test("the model reaches every way an Inspection ends", () => {
  // A: a Lead send-back supersedes, then the Inspector sends back. B (granted): lost, then an
  // approval whose merge was refused, then one that merged.
  const routes = run([0, 3, 21, 2, 3, 12, 1, 4, 28, 2, 4, 10, 2, 4, 7]);

  expect([...routes].sort()).toEqual(["accepted", "approved", "lost", "sent_back", "superseded"]);
});
