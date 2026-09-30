/**
 * The Agent Session lifecycle as an XState statechart, used as the engine's
 * pure decider for everything that moves a Session State (README.md here).
 *
 * The event log stays the source of truth. A session's machine snapshot is
 * never kept in a live actor: it is derived from the folded `SessionRecord`
 * (`snapshotOf`), the engine runs one pure `transition` against it, and
 * persists the domain events the transition emits. The transition's own
 * context update is `foldSession` of those same events, so the next snapshot
 * is exactly the one a restart would fold the log back to.
 *
 * Inputs are Client commands (validated: a command the current state does not
 * accept is rejected with a reason) and signals from the engine's reactors
 * (the Harness, timers, restart recovery). Outputs are emitted events:
 * `domain` (persist), `rejected` (answer the Client) and `effect` (run after
 * commit).
 */
import {
  DomainEvent,
  type RequestId,
  type SessionId,
  type SessionState,
  Turn,
  type TurnId,
} from "@polaris/protocol";
import { Predicate } from "effect";
import { createMachine, isUnhandled, transition, types } from "xstate";
import {
  foldSession,
  lastTurn,
  patchTurn,
  type SessionRecord,
  workingTurn,
} from "../store/model.ts";
import {
  eventSchemas,
  isEmitted,
  type Emitted,
  type SessionEffect,
  type SessionInput,
} from "./session.inputs.ts";
import { endSubagents, subagentEnded, subagentStarted } from "./session.subagents.ts";

export type { SessionEffect, SessionInput } from "./session.inputs.ts";

interface Context {
  /** The folded session; null before it exists. */
  readonly record: SessionRecord | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export const stateChanged = (
  sessionId: SessionId,
  state: SessionState,
  reason: string | null = null
): DomainEvent => DomainEvent.cases.SessionStateChanged.make({ sessionId, state, reason });

const endTurn = (
  turn: Turn,
  status: "completed" | "interrupted" | "failed",
  endedAt: string,
  checkpointAfter: string | null = turn.checkpointAfter
): DomainEvent =>
  DomainEvent.cases.TurnEnded.make({
    turn: patchTurn(turn, { status, endedAt, checkpointAfter }),
  });

const withdrawPending = (
  record: SessionRecord,
  withdrawnBy: "harness" | "daemon",
  reason: string,
  onlyTurn?: TurnId
): Array<DomainEvent> =>
  [...record.pending.values()].flatMap((request) =>
    onlyTurn === undefined || request.turnId === onlyTurn
      ? [
          DomainEvent.cases.ApprovalWithdrawn.make({
            sessionId: record.session.id,
            requestId: request.id,
            withdrawnBy,
            reason,
          }),
        ]
      : []
  );

const RECOVERY_REASON = {
  restart: "The Daemon restarted",
  upgrade: "The Daemon is upgrading",
} as const;

const need = (context: Context): SessionRecord => {
  if (context.record === null) throw new Error("the session machine needs a session");

  return context.record;
};

type Enqueue = { emit: (emitted: Emitted) => void };

/**
 * How XState v6 transition functions read here: returning `undefined` means
 * "not taken", and the event bubbles to the machine-level default; returning
 * an object (even `HANDLED`, no target) takes the transition and stops it.
 */
const HANDLED = {};

/**
 * Emit `events`, then (with `enter`) the Session State change they lead to,
 * and move to the state the fold of all of them gives. A state change
 * re-enters its state, so entry effects run for every `SessionStateChanged`.
 * With nothing to emit it is still taken (`HANDLED`).
 */
const settle = (
  enq: Enqueue,
  record: SessionRecord | null,
  events: ReadonlyArray<DomainEvent>,
  enter?: { readonly state: SessionState; readonly reason?: string | null }
) => {
  const sessionId =
    record?.session.id ?? (events[0]?._tag === "SessionCreated" ? events[0].session.id : undefined);

  if (sessionId === undefined) return undefined;
  const all = enter ? [...events, stateChanged(sessionId, enter.state, enter.reason)] : events;

  if (all.length === 0) return HANDLED;

  for (const event of all) enq.emit({ type: "domain", event });
  const next = foldSession(sessionId, record ?? undefined, all, "")!;
  const moved = enter !== undefined || next.session.state !== record?.session.state;

  const context = { record: next };

  return moved ? { target: `#${next.session.state}`, reenter: true, context } : { context };
};

const reject = (enq: Enqueue, reason: string) => {
  enq.emit({ type: "rejected", reason });
};

/** Session States that take a new Turn (with no Turn in flight). */
const takesTurn = (record: SessionRecord): boolean => {
  if (workingTurn(record) !== undefined) return false;
  const { state } = record.session;

  if (state === "idle" || state === "dormant" || state === "failed") return true;

  // Needs You after a Daemon restart (an Interrupted Turn, nothing pending) takes a new Turn too.
  return state === "needs-you" && record.pending.size === 0;
};

/** Why a new or continued Turn is refused, in the order the checks read to a user. */
const turnRefusal = (record: SessionRecord, kind: "send" | "continue" | "retry"): string => {
  const { state } = record.session;

  const last = lastTurn(record)?.status;

  if (kind === "retry" && last !== "failed") return "there is no Failed Turn to retry";

  if (kind === "continue" && last !== "interrupted") {
    return "there is no Interrupted Turn to continue";
  }

  if (kind !== "send") return `the session is ${state}`;

  if (state === "archived") return "the session is Archived";

  if (state === "in-terminal") return "the session is In Terminal; return it first";

  return `the session is ${state}; wait for the Turn to end`;
};

// ── Machine ─────────────────────────────────────────────────────────────────

/** A new Turn (or the continued one) starts: Working if the Harness is live, else Starting. */
const sendTurn = (
  { context, event }: { context: Context; event: { type: "turn.send"; turn: Turn } },
  enq: Enqueue
) => {
  const record = need(context);

  if (!takesTurn(record)) return undefined;

  return settle(enq, record, [DomainEvent.cases.TurnStarted.make({ turn: event.turn })], {
    state: record.session.state === "idle" ? "working" : "starting",
  });
};

const continueTurn = ({ context }: { context: Context }, enq: Enqueue) => {
  const record = need(context);
  const last = lastTurn(record);

  if (last === undefined || last.status !== "interrupted" || !takesTurn(record)) return undefined;
  // The same Turn resumes: back to working, keeping its before-checkpoint.
  const turn = patchTurn(last, { status: "working", endedAt: null });

  return settle(enq, record, [DomainEvent.cases.TurnStarted.make({ turn })], {
    state: record.session.state === "idle" ? "working" : "starting",
  });
};

/** A Failed last Turn's prompt goes again as a new Turn, like a sent one. */
const retryTurn = (
  { context, event }: { context: Context; event: { type: "turn.retry"; turn: Turn } },
  enq: Enqueue
) => {
  if (lastTurn(need(context))?.status !== "failed") return undefined;

  return sendTurn({ context, event: { type: "turn.send", turn: event.turn } }, enq);
};

/** Turns started by the Harness itself (a co-attached or followed terminal UI). */
const harnessTurn = (
  record: SessionRecord,
  event: { turnId: TurnId; prompt: string; at: string }
): DomainEvent | null =>
  record.turns.some((t) => t.id === event.turnId)
    ? null
    : DomainEvent.cases.TurnStarted.make({
        turn: new Turn({
          id: event.turnId,
          sessionId: record.session.id,
          index: record.session.turnCount,
          prompt: event.prompt,
          attachments: [],
          model: record.session.model,
          effort: record.session.effort,
          status: "working",
          checkpointBefore: null,
          checkpointAfter: null,
          startedAt: event.at,
          endedAt: null,
        }),
      });

type TurnEndedInput = Extract<SessionInput, { type: "harness.turnEnded" }>;

/** The Turn's end as the Harness reports it; `withState` also leaves Working. */
const turnEnded = (
  record: SessionRecord,
  event: TurnEndedInput,
  enq: Enqueue,
  withState: boolean
) => {
  const turn = record.turns.find((t) => t.id === event.turnId);

  if (turn === undefined || turn.status !== "working") return undefined;
  const events: Array<DomainEvent> = [];

  if (event.checkpoint !== null) {
    events.push(
      DomainEvent.cases.CheckpointRecorded.make({
        sessionId: record.session.id,
        turnId: turn.id,
        ref: event.checkpoint.ref,
        commit: event.checkpoint.commit,
      })
    );
  }

  events.push(
    ...withdrawPending(record, "harness", "The Turn ended", turn.id),
    endTurn(turn, event.status, event.at, event.checkpoint?.ref ?? turn.checkpointAfter)
  );

  return settle(
    enq,
    record,
    events,
    !withState
      ? undefined
      : event.status === "failed"
        ? { state: "failed", reason: event.error ?? "The Turn failed" }
        : { state: "idle" }
  );
};

type ExitedInput = Extract<SessionInput, { type: "harness.exited" }>;

/** The Harness went away: its Turn ends, its requests go, the session Fails or goes Dormant. */
const exited = (record: SessionRecord, event: ExitedInput, enq: Enqueue, withState: boolean) => {
  const turn = workingTurn(record);
  const reason = event.error ?? "The Harness exited";

  const events = [
    ...endSubagents(record, event.at),
    ...(turn ? [endTurn(turn, event.error ? "failed" : "interrupted", event.at)] : []),
    ...withdrawPending(record, "harness", reason),
  ];

  return settle(
    enq,
    record,
    events,
    !withState
      ? undefined
      : event.error !== null
        ? { state: "failed", reason: event.error }
        : { state: "dormant", reason: "harness-exited" }
  );
};

type RecoverInput = Extract<SessionInput, { type: "daemon.recover" }>;

/**
 * The recovery rule, for a session whose Harness went away with the Daemon
 * (restart, upgrade): a working Turn becomes Interrupted and the session Needs
 * You (reason `interrupted`) so the user decides with Continue; a Turn is
 * never continued automatically. Pending approvals are withdrawn. Failed stays
 * Failed, a Needs You still waiting on Continue stays, other states go Dormant.
 */
const recover = (record: SessionRecord, event: RecoverInput, enq: Enqueue) => {
  const turn = workingTurn(record);
  const { state } = record.session;

  const events = [
    ...endSubagents(record, event.at),
    ...(turn ? [endTurn(turn, "interrupted", event.at)] : []),
    ...withdrawPending(record, "daemon", RECOVERY_REASON[event.cause]),
  ];

  if (turn !== undefined) {
    return settle(enq, record, events, { state: "needs-you", reason: "interrupted" });
  }

  if (state === "failed" || (state === "needs-you" && lastTurn(record)?.status === "interrupted")) {
    return settle(enq, record, events);
  }

  return settle(enq, record, events, {
    state: "dormant",
    reason: event.cause === "restart" ? "daemon-restart" : "daemon-upgrade",
  });
};

/** Taken, with no change: a state that returns it stops the event from bubbling to the defaults. */
const ignore = () => HANDLED;

/** Interrupt with no Harness running the Turn: end it here (and go Dormant, `withState`). */
const interruptUnattended = (
  record: SessionRecord,
  at: string,
  enq: Enqueue,
  withState: boolean
) => {
  const turn = workingTurn(record);

  if (turn === undefined) return undefined;

  return settle(
    enq,
    record,
    [
      ...endSubagents(record, at),
      ...withdrawPending(record, "daemon", "Interrupted"),
      endTurn(turn, "interrupted", at),
    ],
    withState ? { state: "dormant" } : undefined
  );
};

/**
 * Archive, in every state but Archived: refused while a Turn is in flight
 * (the user interrupts it first, from Polaris or the terminal UI), so an
 * Archived session never holds a working Turn. A request still pending with
 * no Turn in flight (only in logs from before this rule) is withdrawn.
 */
const archive = ({ context, event }: { context: Context; event: { at: string } }, enq: Enqueue) => {
  const record = need(context);

  if (workingTurn(record) !== undefined) {
    return reject(enq, "interrupt the Turn in flight before archiving");
  }

  return settle(
    enq,
    record,
    [
      ...endSubagents(record, event.at),
      ...withdrawPending(record, "daemon", "The session was archived"),
    ],
    { state: "archived" }
  );
};

type ApprovalRequestedInput = Extract<SessionInput, { type: "harness.approvalRequested" }>;

/**
 * A Harness asks for approval: recorded only for the Turn in flight. A request
 * for any other Turn (one that ended, a stale or misbehaving Harness) is
 * ignored, as `turnEnded` ignores a Turn that is not working, so nothing is
 * ever pending without a Turn to answer it for. `enter` is the state it moves
 * the session to, if any.
 */
const approvalRequested = (
  record: SessionRecord,
  event: ApprovalRequestedInput,
  enq: Enqueue,
  enter?: "needs-you"
) => {
  if (workingTurn(record)?.id !== event.request.turnId) return HANDLED;

  return settle(
    enq,
    record,
    [DomainEvent.cases.ApprovalRequested.make({ request: event.request })],
    enter === undefined ? undefined : { state: enter }
  );
};

/** Back to Working once nothing is pending, but only with a Turn to work on. */
const backToWork = (record: SessionRecord, closing: RequestId) =>
  record.pending.size === 1 && record.pending.has(closing) && workingTurn(record) !== undefined
    ? ({ state: "working" } as const)
    : undefined;

export const sessionMachine = createMachine({
  id: "session",
  schemas: {
    context: types<Context>(),
    events: eventSchemas,
    emitted: {
      domain: types<{ event: DomainEvent }>(),
      rejected: types<{ reason: string }>(),
      effect: types<{ effect: SessionEffect }>(),
    },
  },
  context: { record: null },
  initial: "new",
  // Defaults for every existing session; states override what they accept.
  on: {
    "session.start": ({ event }, enq) => reject(enq, `session ${event.session.id} already exists`),
    "session.fork": ({ event }, enq) => reject(enq, `session ${event.session.id} already exists`),
    "turn.send": ({ context }, enq) => reject(enq, turnRefusal(need(context), "send")),
    "turn.continue": ({ context }, enq) => reject(enq, turnRefusal(need(context), "continue")),
    "turn.retry": ({ context }, enq) => reject(enq, turnRefusal(need(context), "retry")),
    "turn.steer": ({ context, event }, enq) => {
      const record = need(context);

      if (workingTurn(record) === undefined || record.session.state === "in-terminal") {
        return reject(enq, "there is no Turn in flight to steer");
      }

      if (!event.canSteer)
        return reject(enq, `${record.session.harness} does not support steering`);
    },
    "turn.interrupt": ({ context }, enq) => {
      if (workingTurn(need(context)) === undefined) reject(enq, "there is no Turn in flight");
    },
    "approval.respond": ({ context, event }, enq) => {
      const record = need(context);

      if (!record.pending.has(event.requestId)) {
        return reject(enq, `request ${event.requestId} is already resolved`);
      }

      return settle(enq, record, [
        DomainEvent.cases.ApprovalResolved.make({
          sessionId: record.session.id,
          requestId: event.requestId,
          decision: event.decision,
          resolvedBy: event.resolvedBy,
        }),
      ]);
    },
    "permissionMode.set": ({ context, event }, enq) => {
      const record = need(context);

      if (record.session.permissionMode === event.permissionMode) return undefined;

      return settle(enq, record, [
        DomainEvent.cases.SessionPermissionModeChanged.make({
          sessionId: record.session.id,
          permissionMode: event.permissionMode,
        }),
      ]);
    },
    // Between Turns only; a Harness that can't switch mid-session only before it has one.
    // Between Turns only; a Harness that can't switch mid-session, only before it has one.
    "model.set": ({ context, event }, enq) => {
      const record = need(context);
      const { session } = record;

      if (workingTurn(record) !== undefined) return reject(enq, turnRefusal(record, "send"));

      if (!event.canSwitchModel && session.harnessCursor !== null) {
        return reject(enq, `${session.harness} can't switch Model mid-session; fork instead`);
      }

      if (session.model === event.model && session.effort === event.effort) return HANDLED;

      return settle(enq, record, [
        DomainEvent.cases.SessionModelChanged.make({
          sessionId: session.id,
          model: event.model,
          effort: event.effort,
        }),
      ]);
    },
    "session.archive": archive,
    "session.unarchive": (_, enq) => reject(enq, "the session is not Archived"),
    "terminal.open": ({ context }, enq) =>
      reject(enq, `the session is ${need(context).session.state}`),
    "terminal.return": (_, enq) => reject(enq, "the session is not In Terminal"),

    "harness.opened": ignore,
    "harness.resumed": ignore,
    "harness.turnStarted": ({ context, event }, enq) => {
      const started = harnessTurn(need(context), event);

      return started === null ? undefined : settle(enq, need(context), [started]);
    },
    "harness.approvalRequested": ({ context, event }, enq) =>
      approvalRequested(need(context), event, enq, "needs-you"),
    "harness.approvalWithdrawn": ({ context, event }, enq) => {
      const record = need(context);

      if (!record.pending.has(event.requestId)) return undefined;

      return settle(enq, record, [
        DomainEvent.cases.ApprovalWithdrawn.make({
          sessionId: record.session.id,
          requestId: event.requestId,
          withdrawnBy: "harness",
          reason: "The Harness withdrew the request",
        }),
      ]);
    },
    "harness.turnEnded": ({ context, event }, enq) => turnEnded(need(context), event, enq, true),
    "harness.subagentStarted": ({ context, event }, enq) =>
      settle(enq, need(context), subagentStarted(need(context), event.subagent)),
    "harness.subagentEnded": ({ context, event }, enq) =>
      settle(enq, need(context), subagentEnded(need(context), event)),
    "harness.exited": ({ context, event }, enq) => exited(need(context), event, enq, true),
    "terminal.closed": ({ context, event }, enq) => {
      // A Turn the terminal UI left open when it closed ends Interrupted.
      const record = need(context);
      const turn = workingTurn(record);

      if (turn === undefined) return undefined;

      return settle(enq, record, [
        ...withdrawPending(record, "harness", "The terminal UI closed", turn.id),
        endTurn(turn, "interrupted", event.at),
      ]);
    },
    "idle.timeout": ignore,
    "session.fail": ({ context, event }, enq) => {
      const record = need(context);
      const turn = workingTurn(record);

      return settle(
        enq,
        record,
        [
          ...endSubagents(record, event.at),
          ...(turn ? [endTurn(turn, "failed", event.at)] : []),
          ...withdrawPending(record, "daemon", event.message),
        ],
        { state: "failed", reason: event.message }
      );
    },
    "turn.interruptUnattended": ({ context, event }, enq) =>
      interruptUnattended(need(context), event.at, enq, true),
    "daemon.recover": ({ context, event }, enq) => recover(need(context), event, enq),
  },
  states: {
    /** Not created yet: only StartSession and ForkSession apply. */
    new: {
      on: {
        "session.start": ({ event }, enq) =>
          settle(enq, null, [
            DomainEvent.cases.SessionCreated.make({ session: event.session }),
            DomainEvent.cases.TurnStarted.make({ turn: event.turn }),
          ]),
        "session.fork": ({ event }, enq) =>
          settle(enq, null, [DomainEvent.cases.SessionCreated.make({ session: event.session })]),
      },
    },
    /** Its Harness is being opened (or resumed) for a Turn or a return from the terminal. */
    starting: {
      id: "starting",
      on: {
        "harness.opened": ({ context }, enq) =>
          settle(enq, need(context), [], { state: "working" }),
        "harness.resumed": ({ context }, enq) => {
          const record = need(context);

          return settle(enq, record, [], {
            state: workingTurn(record) !== undefined ? "working" : "idle",
          });
        },
        "harness.turnStarted": ({ context, event }, enq) => {
          const started = harnessTurn(need(context), event);

          return started === null
            ? undefined
            : settle(enq, need(context), [started], { state: "working" });
        },
      },
    },
    /** The Harness process is known to be running. */
    live: {
      initial: "idle",
      states: {
        idle: {
          id: "idle",
          entry: (_, enq) => enq.emit({ type: "effect", effect: "scheduleIdleStop" }),
          on: {
            "turn.send": sendTurn,
            "turn.continue": continueTurn,
            "turn.retry": retryTurn,
            "terminal.open": ({ context }, enq) =>
              settle(enq, need(context), [], { state: "in-terminal" }),
            "harness.turnStarted": ({ context, event }, enq) => {
              const started = harnessTurn(need(context), event);

              return started === null
                ? undefined
                : settle(enq, need(context), [started], { state: "working" });
            },
            "idle.timeout": ({ context, event }, enq) => {
              if (!event.harnessLive) return undefined;
              enq.emit({ type: "effect", effect: "stopHarness" });

              return settle(enq, need(context), [], { state: "dormant", reason: "idle-timeout" });
            },
          },
        },
        working: { id: "working" },
        "needs-you": {
          id: "needs-you",
          on: {
            // After a restart: an Interrupted Turn waits here for Continue (or a new Turn).
            "turn.send": sendTurn,
            "turn.continue": continueTurn,
            "turn.retry": retryTurn,
            "harness.approvalRequested": ({ context, event }, enq) =>
              approvalRequested(need(context), event, enq),
            "approval.respond": ({ context, event }, enq) => {
              const record = need(context);

              if (!record.pending.has(event.requestId)) return undefined;

              const resolved = DomainEvent.cases.ApprovalResolved.make({
                sessionId: record.session.id,
                requestId: event.requestId,
                decision: event.decision,
                resolvedBy: event.resolvedBy,
              });

              // The last answer puts the Harness back to work (if it has a Turn to work on).
              return settle(enq, record, [resolved], backToWork(record, event.requestId));
            },
            "harness.approvalWithdrawn": ({ context, event }, enq) => {
              const record = need(context);

              // The default handles it unless it removes the last request of a Turn in flight.
              if (backToWork(record, event.requestId) === undefined) return undefined;

              return settle(
                enq,
                record,
                [
                  DomainEvent.cases.ApprovalWithdrawn.make({
                    sessionId: record.session.id,
                    requestId: event.requestId,
                    withdrawnBy: "harness",
                    reason: "The Harness withdrew the request",
                  }),
                ],
                { state: "working" }
              );
            },
          },
        },
      },
    },
    /** The user took the session over in the Harness's own terminal UI. */
    "in-terminal": {
      id: "in-terminal",
      on: {
        "terminal.return": ({ context }, enq) =>
          settle(enq, need(context), [], { state: "starting" }),
        "model.set": (_, enq) => reject(enq, "the session is In Terminal; return it first"),
        // Polaris follows along without changing the state.
        "harness.approvalRequested": ({ context, event }, enq) =>
          approvalRequested(need(context), event, enq),
        "harness.turnEnded": ({ context, event }, enq) =>
          turnEnded(need(context), event, enq, false),
        "harness.exited": ({ context, event }, enq) => exited(need(context), event, enq, false),
        "daemon.recover": ({ context, event }, enq) =>
          // An upgrade leaves a terminal UI alone; a restart recovers it like any live session.
          event.cause === "upgrade" ? HANDLED : recover(need(context), event, enq),
      },
    },
    /** No Harness process; resumes from the cursor on the next Turn. */
    dormant: {
      id: "dormant",
      on: {
        "turn.send": sendTurn,
        "turn.continue": continueTurn,
        "turn.retry": retryTurn,
        "terminal.open": ({ context }, enq) =>
          settle(enq, need(context), [], { state: "in-terminal" }),
        "harness.turnStarted": ({ context, event }, enq) => {
          const started = harnessTurn(need(context), event);

          return started === null
            ? undefined
            : settle(enq, need(context), [started], { state: "working" });
        },
        "harness.exited": ignore,
        "daemon.recover": ignore,
      },
    },
    failed: {
      id: "failed",
      on: {
        "turn.send": sendTurn,
        "turn.continue": continueTurn,
        "turn.retry": retryTurn,
        "terminal.open": ({ context }, enq) =>
          settle(enq, need(context), [], { state: "in-terminal" }),
      },
    },
    archived: {
      id: "archived",
      on: {
        "session.archive": (_, enq) => reject(enq, "the session is already Archived"),
        "session.unarchive": ({ context }, enq) =>
          settle(enq, need(context), [], { state: "dormant" }),
        "permissionMode.set": (_, enq) => reject(enq, "the session is Archived"),
        "model.set": (_, enq) => reject(enq, "the session is Archived"),
        // Its Harness is being stopped: record a Turn's end, nothing else moves it.
        "harness.turnEnded": ({ context, event }, enq) =>
          turnEnded(need(context), event, enq, false),
        "harness.turnStarted": ignore,
        "harness.approvalRequested": ignore,
        "harness.exited": ignore,
        "session.fail": ignore,
        // Only Unarchive leaves Archived.
        "turn.interruptUnattended": ({ context, event }, enq) =>
          interruptUnattended(need(context), event.at, enq, false),
        // Nothing to recover, except in logs from before Archive refused a Turn in flight:
        // close what such a session left open, and keep it Archived.
        "daemon.recover": ({ context, event }, enq) => {
          const record = need(context);
          const turn = workingTurn(record);

          return settle(enq, record, [
            ...endSubagents(record, event.at),
            ...(turn ? [endTurn(turn, "interrupted", event.at)] : []),
            ...withdrawPending(record, "daemon", RECOVERY_REASON[event.cause]),
          ]);
        },
      },
    },
  },
});

// ── Running it ──────────────────────────────────────────────────────────────

export type SessionSnapshot = ReturnType<typeof sessionMachine.resolveState>;

const LIVE: ReadonlyArray<SessionState> = ["idle", "working", "needs-you"];

/** The Session State a snapshot stands for (`new` before the session exists). */
export const stateOf = (snapshot: SessionSnapshot): SessionState | "new" => {
  const value = snapshot.value;

  return Predicate.isString(value) ? value : value.live;
};

const snapshots = new WeakMap<SessionRecord, SessionSnapshot>();

const initial = sessionMachine.resolveState({ value: "new", context: { record: null } });

/** The machine snapshot the folded record stands for. */
export const snapshotOf = (record: SessionRecord | undefined): SessionSnapshot => {
  if (record === undefined) return initial;
  let snapshot = snapshots.get(record);

  if (snapshot === undefined) {
    const { state } = record.session;
    snapshot = sessionMachine.resolveState({
      value: LIVE.includes(state) ? { live: state } : state,
      context: { record },
    });
    snapshots.set(record, snapshot);
  }

  return snapshot;
};

export interface Decision {
  /** Domain events to persist, in order. */
  readonly events: ReadonlyArray<DomainEvent>;
  /** Why a command was refused; null when it was accepted (or for signals). */
  readonly rejection: string | null;
  /** What the engine runs after the events commit. */
  readonly effects: ReadonlyArray<SessionEffect>;
  /** The next snapshot: what the log will fold to once `events` commit. */
  readonly next: SessionSnapshot;
  /** No state handles the input: it changes nothing. */
  readonly unhandled: boolean;
}

/** One pure step of the lifecycle: `transition(snapshotOf(record), input)`. */
export const decideSession = (record: SessionRecord | undefined, input: SessionInput): Decision => {
  const snapshot = snapshotOf(record);

  if (record === undefined && input.type !== "session.start" && input.type !== "session.fork") {
    return { events: [], rejection: null, effects: [], next: snapshot, unhandled: true };
  }

  const result = transition(sessionMachine, snapshot, input);
  const events: Array<DomainEvent> = [];
  const effects: Array<SessionEffect> = [];
  let rejection: string | null = null;

  for (const action of result[1]) {
    if (action.kind !== "emit" || !isEmitted(action.event)) continue;
    const emitted = action.event;

    if (emitted.type === "domain") events.push(emitted.event);
    else if (emitted.type === "rejected") rejection = emitted.reason;
    else effects.push(emitted.effect);
  }

  return { events, rejection, effects, next: result[0], unhandled: isUnhandled(snapshot, result) };
};
