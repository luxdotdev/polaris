/**
 * The Logbook against a reference (ADR 0119; `packages/spec/constellations.qnt`, Logbook
 * section): random commands through the real decider, the real fold over what it commits, and
 * an independent model of who may write, who may read and which entries each command adds.
 */
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AnswerAction,
  AttemptCause,
  AttemptId,
  type ConstellationCommand,
  ConstellationQuestion,
  type DomainEvent,
  type LogbookEntry,
  MessageTarget,
  PlanOperation,
  ReviewAction,
  Sequence,
  SessionId,
  TaskId,
  WorkerPlacement,
} from "@polaris/protocol";
import fc from "fast-check";
import {
  canReadLogbook,
  foldLogbook,
  inScope,
  type LogbookEvent,
  logbookWriter,
  stepLogbook,
} from "../constellation/logbook/index.ts";
import { decideConstellation } from "../engine/constellation.ts";
import type { ConstellationBinding, ConstellationContext } from "../engine/constellation.inputs.ts";
import {
  A,
  B,
  C,
  CID,
  HOST,
  LEAD,
  WS,
  ctx,
  draft,
  foldDecision,
  report,
  task,
} from "../engine/constellation.testing.ts";
import { type ConstellationRecord, graphEvent } from "../store/constellation.ts";
import { pbtRuns, pbtSeed, pbtTimeout } from "./pbt.ts";

const X = TaskId.make("X");

/** B depends on A; X stands alone. */
const TASKS = [A, B, X];

const STRANGER = SessionId.make("stranger");

interface RefAttempt {
  readonly id: string;
  readonly task: TaskId;
  readonly number: number;
  readonly session: SessionId;
  state: "working" | "review" | "accepted" | "rejected" | "lost";
  head: string | null;
  revision: number;
  /** Ids of its questions nobody has answered. */
  readonly open: Array<string>;
}

/** The reference: Attempts in the order they started, and the rows each command should add. */
interface Reference {
  readonly attempts: Array<RefAttempt>;
  readonly rows: Array<string>;
}

type Role = "worker" | "lead" | "you" | "polaris";

const row = (taskId: TaskId, kind: LogbookEntry["_tag"], author: Role, attempt: number | null) =>
  `${taskId} ${kind} ${author} #${attempt ?? "-"}`;

const latest = (ref: Reference, taskId: TaskId) => ref.attempts.findLast((a) => a.task === taskId);

const live = (attempt: RefAttempt | undefined): attempt is RefAttempt =>
  attempt !== undefined && (attempt.state === "working" || attempt.state === "review");

const done = (ref: Reference, taskId: TaskId) => latest(ref, taskId)?.state === "accepted";

const user: ConstellationBinding = { kind: "user" };

const lead: ConstellationBinding = { kind: "session", sessionId: LEAD };

const as = (sessionId: SessionId): ConstellationBinding => ({ kind: "session", sessionId });

/** The Lead on even steps, the user on odd ones. */
const operator = (index: number) =>
  index % 2 === 0
    ? { binding: lead, role: "lead" as const }
    : { binding: user, role: "you" as const };

/** The role `binding` writes `taskId`'s Logbook as, by the rule and nothing else. */
const writer = (ref: Reference, taskId: TaskId, binding: ConstellationBinding): Role | null => {
  if (binding.kind === "user") return "you";

  if (binding.sessionId === LEAD) return "lead";

  const attempt = latest(ref, taskId);

  return live(attempt) && attempt.session === binding.sessionId ? "worker" : null;
};

/** Writers read; so does B's current worker, of A, which B depends on. */
const reader = (ref: Reference, taskId: TaskId, binding: ConstellationBinding) => {
  if (writer(ref, taskId, binding) !== null) return true;

  const dependent = latest(ref, B);

  return (
    taskId === A &&
    binding.kind === "session" &&
    live(dependent) &&
    dependent.session === binding.sessionId
  );
};

/** One command, whether the rules allow it, and what it does to the reference when they do. */
interface Step {
  readonly command: ConstellationCommand;
  readonly context: ConstellationContext;
  readonly allowed: boolean;
  readonly apply: () => void;
  /** A settle needs its replay context: Connection State isn't in the events. */
  readonly settles?: boolean;
}

const attemptId = (attempt: RefAttempt | undefined) => AttemptId.make(attempt?.id ?? "missing");

const sessionOf = (attempt: RefAttempt | undefined, taskId: TaskId) =>
  attempt?.session ?? SessionId.make(`w-${taskId}`);

const start = (
  ref: Reference,
  taskId: TaskId,
  index: number,
  after: "SentBack" | "Recover" = "Recover"
) => {
  const session = SessionId.make(`w-${taskId}-${index}`);
  const number = ref.attempts.filter((a) => a.task === taskId).length + 1;
  const previous = latest(ref, taskId);

  const cause =
    previous === undefined
      ? AttemptCause.cases.Initial.make({})
      : AttemptCause.cases[after].make({ ref: AttemptId.make(previous.id) });

  return {
    draft: draft(taskId, `a-${index}`, session, cause),
    session,
    apply: () => {
      ref.attempts.push({
        id: `a-${index}`,
        task: taskId,
        number,
        session,
        state: "working",
        head: null,
        revision: 0,
        open: [],
      });
    },
  };
};

const dispatch = (ref: Reference, taskId: TaskId, index: number): Step => {
  const next = start(ref, taskId, index);
  const previous = latest(ref, taskId);

  return {
    command: C.Dispatch.make({
      constellationId: CID,
      tasks: [{ taskId, worker: WorkerPlacement.cases.Existing.make({ sessionId: next.session }) }],
    }),
    context: ctx({ binding: lead, attempts: [next.draft] }),
    allowed:
      (previous === undefined || previous.state === "lost") && (taskId !== B || done(ref, A)),
    apply: next.apply,
  };
};

/** A worker command from the Task's latest Attempt, allowed while that Attempt is live. */
const fromWorker = (
  ref: Reference,
  taskId: TaskId,
  make: (attempt: AttemptId) => ConstellationCommand,
  apply: (attempt: RefAttempt) => void,
  context: Partial<ConstellationContext> = {}
): Step => {
  const attempt = latest(ref, taskId);

  return {
    command: make(attemptId(attempt)),
    context: ctx({ binding: as(sessionOf(attempt, taskId)), ...context }),
    allowed: live(attempt),
    apply: () => {
      if (attempt !== undefined) apply(attempt);
    },
  };
};

const progress = (ref: Reference, taskId: TaskId): Step =>
  fromWorker(
    ref,
    taskId,
    (id) =>
      C.WorkerProgress.make({
        constellationId: CID,
        attemptId: id,
        note: "Working",
        completed: null,
        total: null,
        waiting: null,
      }),
    (attempt) => {
      attempt.revision += 1;
      ref.rows.push(row(taskId, "Progress", "worker", attempt.number));
    }
  );

const claim = (ref: Reference, taskId: TaskId, index: number): Step => {
  const head = `head-${index}`;
  const branch = `polaris/${taskId}`;

  return fromWorker(
    ref,
    taskId,
    (id) =>
      C.WorkerClaim.make({ constellationId: CID, attemptId: id, claim: report(branch, head) }),
    (attempt) => {
      attempt.state = "review";
      attempt.head = head;
      attempt.revision += 1;
      ref.rows.push(row(taskId, "Claim", "worker", attempt.number));
    },
    { claimProbe: { dirtyPaths: [], branch, head } }
  );
};

const ask = (ref: Reference, taskId: TaskId, index: number): Step =>
  fromWorker(
    ref,
    taskId,
    (id) =>
      C.WorkerAsk.make({
        constellationId: CID,
        attemptId: id,
        question: new ConstellationQuestion({
          id: `q-${index}`,
          to: "lead",
          text: "Which base?",
          blocking: false,
        }),
      }),
    (attempt) => {
      attempt.open.push(`q-${index}`);
      ref.rows.push(row(taskId, "Question", "worker", attempt.number));
    }
  );

/** The Lead or the user answers the oldest open question of the Task's live Attempt. */
const answer = (ref: Reference, taskId: TaskId, index: number): Step => {
  const attempt = latest(ref, taskId);
  const questionId = live(attempt) ? attempt.open[0] : undefined;
  const by = operator(index);

  return {
    command: C.Answer.make({
      constellationId: CID,
      action: AnswerAction.cases.Question.make({
        attemptId: attemptId(attempt),
        questionId: questionId ?? "none",
        text: "Use main.",
      }),
    }),
    context: ctx({ binding: by.binding }),
    allowed: questionId !== undefined,
    apply: () => {
      attempt?.open.shift();
      ref.rows.push(row(taskId, "Answer", by.role, attempt?.number ?? null));
    },
  };
};

/** A review of the Task's latest Attempt at its current revision, allowed while a Claim is in review. */
const review = (
  ref: Reference,
  taskId: TaskId,
  action: (attempt: RefAttempt | undefined) => typeof ReviewAction.Type,
  binding: ConstellationBinding,
  apply: (attempt: RefAttempt) => void,
  context: Partial<ConstellationContext> = {}
): Step => {
  const attempt = latest(ref, taskId);

  return {
    command: C.Review.make({
      constellationId: CID,
      attemptId: attemptId(attempt),
      revision: attempt?.revision ?? 0,
      action: action(attempt),
    }),
    context: ctx({ binding, ...context }),
    allowed: attempt?.state === "review",
    apply: () => {
      if (attempt !== undefined) apply(attempt);
    },
  };
};

const accept = (ref: Reference, taskId: TaskId, index: number): Step =>
  review(
    ref,
    taskId,
    (attempt) =>
      ReviewAction.cases.Accept.make({ mergedHead: attempt?.head ?? "none", receipts: [] }),
    operator(index).binding,
    (attempt) => {
      attempt.state = "accepted";
      // The Lead merges and accepts, also when the user asked for it.
      ref.rows.push(row(taskId, "Review", "lead", attempt.number));
    }
  );

const sendBack = (ref: Reference, taskId: TaskId, index: number): Step => {
  const next = start(ref, taskId, index, "SentBack");
  const by = operator(index);

  return review(
    ref,
    taskId,
    () =>
      ReviewAction.cases.SendBack.make({
        reason: "Add the test.",
        worker: WorkerPlacement.cases.Existing.make({ sessionId: next.session }),
      }),
    by.binding,
    (attempt) => {
      attempt.state = "rejected";
      ref.rows.push(row(taskId, "Review", by.role, attempt.number));
      next.apply();
    },
    { attempts: [next.draft] }
  );
};

const stop = (ref: Reference, taskId: TaskId): Step => {
  const attempt = latest(ref, taskId);

  return {
    command: C.Review.make({
      constellationId: CID,
      attemptId: attemptId(attempt),
      revision: attempt?.revision ?? 0,
      action: ReviewAction.cases.Stop.make({ reason: "No longer needed." }),
    }),
    context: ctx({ binding: lead, commanded: true }),
    allowed: live(attempt),
    settles: true,
    apply: () => {
      if (attempt === undefined) return;
      attempt.state = "lost";
      ref.rows.push(row(taskId, "Lost", "polaris", attempt.number));
    },
  };
};

/** A note on `taskId` from `binding`: allowed exactly when the rule names a writer. */
const note = (ref: Reference, taskId: TaskId, binding: ConstellationBinding): Step => {
  const role = writer(ref, taskId, binding);

  return {
    command: C.Note.make({ constellationId: CID, taskId, text: "For the record." }),
    context: ctx({ binding }),
    allowed: role !== null,
    apply: () => {
      if (role !== null)
        ref.rows.push(row(taskId, "Note", role, latest(ref, taskId)?.number ?? null));
    },
  };
};

const message = (ref: Reference, taskId: TaskId, index: number): Step => {
  const attempt = latest(ref, taskId);
  const by = operator(index);

  return {
    command: C.Message.make({
      constellationId: CID,
      target: MessageTarget.cases.Worker.make({ attemptId: attemptId(attempt) }),
      text: "Keep going.",
    }),
    context: ctx({ binding: by.binding }),
    allowed: live(attempt),
    apply: () => {
      ref.rows.push(row(taskId, "Message", by.role, attempt?.number ?? null));
    },
  };
};

/** A broadcast lands on the Logbook of every Task with a live Attempt, in the order they started. */
const broadcast = (ref: Reference, index: number): Step => {
  const by = operator(index);

  return {
    command: C.Message.make({
      constellationId: CID,
      target: MessageTarget.cases.All.make({}),
      text: "Rebase on main.",
    }),
    context: ctx({ binding: by.binding }),
    allowed: true,
    apply: () => {
      for (const attempt of ref.attempts.filter(live))
        ref.rows.push(row(attempt.task, "Message", by.role, attempt.number));
    },
  };
};

/** A peer message is on the sender's Logbook, then the recipient's. */
const peer = (ref: Reference, taskId: TaskId, to: TaskId): Step => {
  const recipient = latest(ref, to);

  return fromWorker(
    ref,
    taskId,
    (id) => C.WorkerMessage.make({ constellationId: CID, attemptId: id, to, text: "Which head?" }),
    (attempt) => {
      ref.rows.push(row(taskId, "Message", "worker", attempt.number));
      ref.rows.push(row(to, "Message", "worker", recipient?.number ?? null));
    }
  );
};

const step = (ref: Reference, op: number, index: number): Step => {
  const taskId = TASKS[op % 3]!;
  const other = TASKS[(op + 1) % 3]!;
  const first = ref.attempts.find((a) => a.task === taskId);

  const steps: ReadonlyArray<() => Step> = [
    () => dispatch(ref, taskId, index),
    () => progress(ref, taskId),
    () => claim(ref, taskId, index),
    () => accept(ref, taskId, index),
    () => sendBack(ref, taskId, index),
    () => stop(ref, taskId),
    () => ask(ref, taskId, index),
    () => answer(ref, taskId, index),
    () => message(ref, taskId, index),
    () => broadcast(ref, index),
    () => {
      const sent = peer(ref, taskId, other);

      return { ...sent, allowed: sent.allowed && live(latest(ref, other)) };
    },
    // Notes: the Task's current worker, the Lead or the user, another Task's worker, the Task's
    // first worker (stale once it was sent back), and a session outside the Constellation.
    () => note(ref, taskId, as(sessionOf(latest(ref, taskId), taskId))),
    () => note(ref, taskId, operator(index).binding),
    () => note(ref, taskId, as(sessionOf(latest(ref, other), other))),
    () => note(ref, taskId, as(sessionOf(first, taskId))),
    () => note(ref, taskId, as(STRANGER)),
  ];

  return steps[Math.floor(op / 3) % steps.length]!();
};

const OPS = 16 * 3;

const shown = (entry: LogbookEntry) =>
  row(
    entry.taskId,
    entry._tag,
    entry.author === "inspector" ? "polaris" : entry.author,
    entry.attempt
  );

/** Everyone who could ask: the user, the Lead, every worker so far and an outsider. */
const callers = (ref: Reference): ReadonlyArray<ConstellationBinding> => [
  user,
  lead,
  as(STRANGER),
  ...ref.attempts.map((a) => as(a.session)),
];

/** The fold's own properties, whatever the commands were. */
const checkFold = (
  envelopes: ReadonlyArray<LogbookEvent>,
  entries: ReadonlyArray<LogbookEntry>
) => {
  expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);

  for (const taskId of TASKS) {
    const own = entries.filter((e) => e.taskId === taskId);
    const numbers = own.map((e) => e.attempt ?? 0);

    // Attempt boundaries hold: no entry is filed under an Attempt earlier than the one before it.
    expect(numbers).toEqual([...numbers].sort((x, y) => x - y));
    expect(own.map((e) => e.sequence)).toEqual(own.map((e) => e.sequence).sort((x, y) => x - y));
  }

  // A read from any cursor is exactly the entries committed after it.
  const cut = Sequence.make(Math.floor(envelopes.length / 2));

  expect(inScope(entries, { constellationId: CID, since: cut })).toEqual(
    foldLogbook(envelopes).entries.filter((e) => e.sequence > cut)
  );
};

let traceIndex = 0;

interface Batch {
  readonly hostId: string;
  readonly events: ReadonlyArray<DomainEvent>;
  readonly context?: {
    readonly offlineSessionIds: ReadonlyArray<string>;
    readonly commanded: boolean;
  };
}

const writeTrace = (batches: ReadonlyArray<Batch>) => {
  if (process.env.POLARIS_TRACE_DIR === undefined) return;

  mkdirSync(process.env.POLARIS_TRACE_DIR, { recursive: true });
  writeFileSync(
    join(process.env.POLARIS_TRACE_DIR, `logbook-${traceIndex++}.json`),
    JSON.stringify({ version: 1, ownerHostId: HOST, batches })
  );
};

const run = (operations: ReadonlyArray<number>) => {
  const plan = decideConstellation(
    undefined,
    C.Plan.make({
      constellationId: CID,
      start: { name: "logbook", workspaceId: WS, leadSessionId: LEAD },
      operations: [task(A), task(B, [A]), task(X)].map((t) =>
        PlanOperation.cases.Add.make({ task: t })
      ),
    }),
    ctx()
  );

  let record: ConstellationRecord = foldDecision(undefined, plan.events);
  const ref: Reference = { attempts: [], rows: TASKS.map((t) => row(t, "Brief", "lead", null)) };
  const envelopes: Array<LogbookEvent> = [];
  const stepped: Array<LogbookEntry> = [];
  const batches: Array<Batch> = [];
  let fold = foldLogbook([]).fold;

  const commit = (events: ReadonlyArray<DomainEvent>, settles = false) => {
    const batch: Batch = { hostId: HOST, events };

    batches.push(
      settles ? { ...batch, context: { offlineSessionIds: [], commanded: true } } : batch
    );

    for (const domain of events) {
      const event = graphEvent(domain);

      if (event === null) continue;

      const envelope = {
        sequence: Sequence.make(envelopes.length + 1),
        occurredAt: new Date(Date.UTC(2026, 9, 1, 0, 0, envelopes.length)).toISOString(),
        event,
      };

      envelopes.push(envelope);
      const next = stepLogbook(fold, envelope);
      fold = next.fold;
      stepped.push(...next.entries);
    }
  };

  commit(plan.events);

  for (const [index, op] of operations.entries()) {
    const input = step(ref, op, index);
    const decision = decideConstellation(record, input.command, input.context);

    expect(
      decision.rejection === null,
      JSON.stringify({ op, index, findings: decision.rejection?.findings })
    ).toBe(input.allowed);

    if (decision.rejection === null) {
      record = foldDecision(record, decision.events);
      input.apply();
      commit(decision.events, input.settles === true);
    } else expect(decision.events).toEqual([]);

    // The real rules agree with the reference for every caller and Task.
    for (const binding of callers(ref))
      for (const taskId of TASKS) {
        expect(logbookWriter(binding, record, taskId)).toBe(
          // SAFETY: the reference never writes as `polaris`; the other roles are the note authors.
          writer(ref, taskId, binding) as ReturnType<typeof logbookWriter>
        );
        expect(canReadLogbook(binding, record, taskId)).toBe(reader(ref, taskId, binding));
      }
  }

  // Folding event by event and folding the whole log give the same Logbook.
  expect(stepped).toEqual(foldLogbook(envelopes).entries);
  expect(stepped.map(shown)).toEqual(ref.rows);
  expect([...fold.ordinals].map(([id, o]) => `${id} ${o.taskId} ${o.number}`)).toEqual(
    ref.attempts.map((a) => `${a.id} ${a.task} ${a.number}`)
  );
  checkFold(envelopes, stepped);
  writeTrace(batches);

  return { rows: ref.rows, ref };
};

const RUNS = pbtRuns(100);

test(
  "model sequences: the Logbook's writers, readers and entries match the reference",
  () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: OPS - 1 }), { minLength: 20, maxLength: 120 }),
        (operations) => {
          run(operations);
        }
      ),
      { numRuns: RUNS, ...pbtSeed() }
    );
  },
  pbtTimeout(RUNS, 150)
);

test("a sent-back Attempt's worker stops writing, and its successor's entries follow it", () => {
  // Dispatch A, note, claim, send back (the user), then notes from the first and the second worker.
  const { rows } = run([0, 33, 6, 12, 42, 33]);

  expect(rows.filter((r) => r.startsWith("A "))).toEqual([
    "A Brief lead #-",
    "A Note worker #1",
    "A Claim worker #1",
    "A Review you #1",
    "A Note worker #2",
  ]);
});

test("the worker of a Task that depends on another reads its Logbook but does not write it", () => {
  // Dispatch A, claim, accept; dispatch B; B's worker notes on A (refused), then on B.
  const { rows, ref } = run([0, 6, 9, 1, 41, 34]);
  const dependent = ref.attempts.find((a) => a.task === B)!;

  expect(reader(ref, A, as(dependent.session))).toBe(true);
  expect(rows.filter((r) => r.includes("Note"))).toEqual(["B Note worker #1"]);
});
