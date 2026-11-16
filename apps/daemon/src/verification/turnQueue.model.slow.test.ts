/**
 * The real session decider against `packages/spec/turn-queue.qnt` (ENG-941): random Turns
 * from three people into a shared or unshared session, cancels and edits, Turn ends and lost
 * Harnesses, compared step by step with a reference that transcribes the spec's `apply`.
 */
import { expect, test } from "bun:test";
import {
  Actor,
  AgentSession,
  Command,
  CommandId,
  DomainEvent,
  PersonId,
  SessionId,
  ShareId,
  TurnId,
  WorkspaceId,
} from "@polaris/protocol";
import { Effect, Exit, Predicate } from "effect";
import fc from "fast-check";
import { decide, type DecideContext } from "../engine/decider.ts";
import { QUEUE_LIMIT } from "../engine/session.queue.ts";
import { decideSession, type SessionInput } from "../engine/session.ts";
import { emptyModel, foldSession, type SessionRecord, workingTurn } from "../store/model.ts";
import { queueOf } from "../store/queuedTurns.ts";
import { pbtRuns, pbtSeed, pbtTimeout } from "./pbt.ts";

const runs = pbtRuns(500);

const AT = "2026-11-16T00:00:00.000Z";

const S = SessionId.make("s-queue-model");

/** The spec's people: 0 is the owner, 1 and 2 Teammates holding the `turn` Grant. */
const PEOPLE = [0, 1, 2] as const;

const actorOf = (person: number): Actor =>
  person === 0
    ? Actor.cases.Client.make({})
    : Actor.cases.Teammate.make({
        shareId: ShareId.make(`share-${person}`),
        personId: PersonId.make(`person-${person}`),
        name: `Person ${person}`,
      });

const personOf = (actor: Actor | null | undefined): number =>
  actor == null || !Predicate.isTagged(actor, "Teammate")
    ? 0
    : Number(actor.personId.slice("person-".length));

interface Queued {
  readonly id: number;
  readonly by: number;
  readonly prompt: number;
}

type Outcome = "started" | "queued" | "refused" | "changed" | "nothing";

/** The spec's `View`, without its ghosts. */
interface View {
  readonly state: "idle" | "working" | "stopped";
  readonly inFlight: number;
  readonly queue: ReadonlyArray<Queued>;
  readonly ran: ReadonlyArray<Queued>;
  readonly next: number;
  readonly last: Outcome;
}

const EMPTY: View = {
  state: "stopped",
  inFlight: -1,
  queue: [],
  ran: [],
  next: 0,
  last: "nothing",
};

type Step =
  | { readonly type: "send"; readonly by: number; readonly shared: boolean }
  | { readonly type: "cancel" | "edit"; readonly id: number; readonly by: number }
  | {
      readonly type: "end";
      readonly status: "completed" | "interrupted" | "failed";
      /** The Teammates whose Share ended by now (`EndBarring`); only a clean end reads it. */
      readonly barred: ReadonlyArray<number>;
    }
  | { readonly type: "lose"; readonly how: "exit" | "crash" | "restart" | "fail" };

const send = (v: View, by: number, shared: boolean): View => {
  const turn = { id: v.next, by, prompt: 0 };

  if (v.inFlight < 0)
    return {
      ...v,
      state: "working",
      inFlight: turn.id,
      ran: [...v.ran, turn],
      next: v.next + 1,
      last: "started",
    };

  return shared && v.queue.length < QUEUE_LIMIT
    ? { ...v, queue: [...v.queue, turn], next: v.next + 1, last: "queued" }
    : { ...v, last: "refused" };
};

const change = (v: View, id: number, by: number, cancel: boolean): View => {
  const entry = v.queue.find((q) => q.id === id);

  if (entry === undefined || !(by === 0 || by === entry.by)) return { ...v, last: "refused" };

  return cancel
    ? { ...v, queue: v.queue.filter((q) => q.id !== id), last: "changed" }
    : {
        ...v,
        queue: v.queue.map((q) => (q.id === id ? { ...q, prompt: q.prompt + 1 } : q)),
        last: "changed",
      };
};

const drop = (v: View): View => ({
  ...v,
  state: "stopped",
  inFlight: -1,
  queue: [],
  last: "nothing",
});

const end = (v: View, status: string, barred: ReadonlyArray<number>): View => {
  if (v.inFlight < 0) return v;

  if (status === "failed") return drop(v);
  const [first, ...rest] = v.queue.filter((q) => !barred.includes(q.by));

  return first === undefined
    ? { ...v, state: "idle", inFlight: -1, queue: [], last: "nothing" }
    : {
        ...v,
        state: "working",
        inFlight: first.id,
        ran: [...v.ran, first],
        queue: rest,
        last: "started",
      };
};

/** `apply` of turn-queue.qnt. */
const apply = (v: View, step: Step): View => {
  switch (step.type) {
    case "send":
      return send(v, step.by, step.shared);
    case "cancel":
    case "edit":
      return change(v, step.id, step.by, step.type === "cancel");
    case "end":
      return end(v, step.status, step.barred);
    case "lose":
      return v.inFlight < 0 ? v : drop(v);
  }
};

// ── The real decider ────────────────────────────────────────────────────────

const turnId = (id: number) => TurnId.make(`t${id}`);

const idOf = (id: TurnId) => Number(id.slice(1));

const promptOf = (id: number, edits: number) => `${id}:${edits}`;

const parse = (id: TurnId, prompt: string, actor: Actor | null | undefined): Queued => ({
  id: idOf(id),
  by: personOf(actor),
  prompt: Number(prompt.split(":")[1]),
});

interface Real {
  readonly record: SessionRecord;
  readonly ran: ReadonlyArray<Queued>;
  readonly last: Outcome;
}

const fresh = (): SessionRecord =>
  foldSession(
    S,
    undefined,
    decideSession(undefined, {
      type: "session.fork",
      session: new AgentSession({
        id: S,
        workspaceId: WorkspaceId.make("ws"),
        harness: "claude",
        title: "model",
        cwd: "/model",
        worktreeId: null,
        state: "dormant",
        permissionMode: "supervised",
        model: null,
        effort: null,
        parentSessionId: null,
        forkedFromTurnId: null,
        harnessCursor: null,
        turnCount: 0,
        contextUsage: null,
        lastError: null,
        createdAt: AT,
        updatedAt: AT,
      }),
    }).events,
    AT
  )!;

const context = (by: number, id: number, shared: boolean): DecideContext => ({
  commandId: CommandId.make(`c${id}`),
  now: AT,
  deviceLabel: "model",
  actor: actorOf(by),
  shared,
  newTurnId: turnId(id),
  newWorkspaceId: WorkspaceId.make("unused"),
  attachments: [],
  pathProbe: null,
  canSteer: false,
  canSwitchModel: false,
  canStopBackground: false,
  canBackgroundCommand: false,
  runningCommands: [],
  namedTurn: null,
  judgedSummary: null,
});

/** Fold what a step emitted, noting the Turns it started and what it did to the queue. */
const after = (real: Real, events: ReadonlyArray<DomainEvent>, refused: boolean): Real => {
  const started = events.flatMap((event) =>
    DomainEvent.guards.TurnStarted(event)
      ? [parse(event.turn.id, event.turn.prompt, event.turn.actor)]
      : []
  );

  const last: Outcome = refused
    ? "refused"
    : started.length > 0
      ? "started"
      : events.some(DomainEvent.guards.TurnQueued)
        ? "queued"
        : events.some(DomainEvent.isAnyOf(["QueuedTurnCancelled", "QueuedTurnEdited"]))
          ? "changed"
          : "nothing";

  return { record: foldSession(S, real.record, events, AT)!, ran: [...real.ran, ...started], last };
};

/** An engine signal: it may start the head of the queue, and never answers a command. */
const signal = (real: Real, input: SessionInput): Real => {
  const next = after(real, decideSession(real.record, input).events, false);

  return { ...next, last: next.last === "started" ? "started" : "nothing" };
};

const command = (real: Real, by: number, id: number, shared: boolean, c: Command): Real => {
  const model = { ...emptyModel, sessions: new Map([[S, real.record]]) };
  const exit = Effect.runSyncExit(decide(model, c, context(by, id, shared)));

  if (Exit.isFailure(exit)) return { ...real, last: "refused" };
  const next = after(real, exit.value, false);

  // The reactor opens (or reuses) the Harness for a Turn that started.
  return next.last === "started"
    ? { ...signal(next, { type: "harness.opened" }), last: "started" }
    : next;
};

const LOSSES = {
  exit: { type: "harness.exited", error: null, at: AT },
  crash: { type: "harness.exited", error: "boom", at: AT },
  restart: { type: "daemon.recover", cause: "restart", at: AT },
  fail: { type: "session.fail", message: "the Harness could not start", at: AT },
} satisfies Record<string, SessionInput>;

/** One step against the real decider; `expected` is the reference before it, for fresh ids. */
const run = (real: Real, step: Step, expected: View): Real => {
  const working = workingTurn(real.record);

  switch (step.type) {
    case "send":
      return command(
        real,
        step.by,
        expected.next,
        step.shared,
        Command.cases.SendTurn.make({
          sessionId: S,
          prompt: promptOf(expected.next, 0),
          attachments: [],
        })
      );
    case "cancel":
      return command(
        real,
        step.by,
        0,
        false,
        Command.cases.CancelQueuedTurn.make({ sessionId: S, turnId: turnId(step.id) })
      );
    case "edit": {
      const edits = expected.queue.find((q) => q.id === step.id)?.prompt ?? 0;

      return command(
        real,
        step.by,
        0,
        false,
        Command.cases.EditQueuedTurn.make({
          sessionId: S,
          turnId: turnId(step.id),
          prompt: promptOf(step.id, edits + 1),
        })
      );
    }

    case "end":
      return working === undefined
        ? real
        : signal(real, {
            type: "harness.turnEnded",
            turnId: working.id,
            status: step.status,
            error: step.status === "failed" ? "the Turn failed" : null,
            checkpoint: null,
            endedShares: step.barred.map((person) => ShareId.make(`share-${person}`)),
            at: AT,
          });
    case "lose":
      return working === undefined ? real : { ...signal(real, LOSSES[step.how]), last: "nothing" };
  }
};

const observe = (real: Real): Omit<View, "next"> => {
  const working = workingTurn(real.record);

  return {
    state:
      working !== undefined ? "working" : real.record.session.state === "idle" ? "idle" : "stopped",
    inFlight: working === undefined ? -1 : idOf(working.id),
    queue: queueOf(real.record).map((q) => parse(q.id, q.prompt, q.actor)),
    ran: real.ran,
    last: real.last,
  };
};

const person = fc.constantFrom(...PEOPLE);

/** An id near the ones handed out, so cancels and edits often name a queued Turn. */
const near = fc.integer({ min: 0, max: 12 });

const step: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.record({ type: fc.constant("send" as const), by: person, shared: fc.boolean() }),
  },
  {
    weight: 2,
    arbitrary: fc.record({ type: fc.constant("cancel" as const), id: near, by: person }),
  },
  { weight: 2, arbitrary: fc.record({ type: fc.constant("edit" as const), id: near, by: person }) },
  {
    weight: 3,
    arbitrary: fc.record({
      type: fc.constant("end" as const),
      status: fc.constantFrom(
        "completed" as const,
        "completed" as const,
        "interrupted" as const,
        "failed" as const
      ),
      barred: fc.constantFrom<ReadonlyArray<number>>([], [], [], [1], [2], [1, 2]),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant("lose" as const),
      how: fc.constantFrom("exit" as const, "crash" as const, "restart" as const, "fail" as const),
    }),
  }
);

test(
  "the session decider queues, starts, cancels and drops Turns as turn-queue.qnt's apply does",
  () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 28 }), (steps) => {
        let expected = EMPTY;
        let real: Real = { record: fresh(), ran: [], last: "nothing" };

        for (const next of steps) {
          const before = expected;
          expected = apply(before, next);
          real = run(real, next, before);

          const { next: _next, ...view } = expected;
          expect(observe(real)).toEqual(view);
          // `queueNeedsATurn`: nothing waits behind no Turn.
          expect(queueOf(real.record).length === 0 || workingTurn(real.record) !== undefined).toBe(
            true
          );
        }
      }),
      { numRuns: runs, ...pbtSeed() }
    );
  },
  pbtTimeout(runs, 100)
);
