/**
 * A test model over the session machine for `xstate/graph`: abstract Steps a
 * test can also drive against the real Engine (a Client command, something
 * the fake Harness reports, a Daemon restart), each followed by what the
 * Engine then does on its own (opening the Harness for a Turn, resuming it
 * after the terminal, the fake's reply to an interrupt). Not used in production.
 */
import {
  AgentSession,
  ApprovalDecision,
  ApprovalRequest,
  type HarnessKind,
  RequestId,
  SessionId,
  type SessionState,
  Turn,
  TurnId,
  WorkspaceId,
} from "@polaris/protocol";
import type { ActorLogic } from "xstate";
import {
  adjacencyMapToArray,
  getAdjacencyMap,
  getShortestPaths,
  type TraversalOptions,
} from "xstate/graph";
import { lastTurn, type SessionRecord, workingTurn } from "../store/model.ts";
import {
  decideSession,
  type SessionInput,
  type SessionSnapshot,
  snapshotOf,
  stateOf,
} from "./session.ts";

export const AT = "2026-01-01T00:00:00.000Z";

export const SESSION = SessionId.make("s-model");

/** What a test can do to a session, in the terms of the Engine's public surface. */
export type Step =
  | { readonly type: "start" }
  | { readonly type: "fork" }
  | { readonly type: "send" }
  | { readonly type: "continue" }
  | { readonly type: "interrupt" }
  | { readonly type: "approve" }
  | { readonly type: "archive" }
  | { readonly type: "unarchive" }
  | { readonly type: "openTerminal" }
  | { readonly type: "returnTerminal" }
  /** Changes nothing the model observes; it is here for its refusals. */
  | { readonly type: "setModel" }
  /** The fake Harness (or, In Terminal, the followed terminal UI) reports… */
  | { readonly type: "requestApproval" }
  /** …an approval request for a Turn that already ended (a stale or misbehaving Harness). */
  | { readonly type: "lateApproval" }
  | { readonly type: "withdrawApproval" }
  | { readonly type: "terminalTurn" }
  | { readonly type: "complete" }
  | { readonly type: "failTurn" }
  | { readonly type: "exit" }
  | { readonly type: "crash" }
  /** The Daemon restarts onto the same store. */
  | { readonly type: "restart" };

export const COMMAND_STEPS = [
  "send",
  "continue",
  "interrupt",
  "approve",
  "archive",
  "unarchive",
  "openTerminal",
  "returnTerminal",
  "setModel",
] as const satisfies ReadonlyArray<Step["type"]>;

export interface ModelSnapshot {
  readonly status: "active";
  readonly output: undefined;
  readonly error: undefined;
  readonly machine: SessionSnapshot;
  /** A Harness process of this session is running (the Engine's `live` map). */
  readonly live: boolean;
  /** Ids handed out so far, so every Turn and request is new. */
  readonly counter: number;
}

export interface ModelOptions {
  readonly harness: HarnessKind;
  /** Codex: the TUI co-attaches to the running Harness. Claude: sequential hand-off. */
  readonly liveCoAttach: boolean;
  /** The Harness can change Model mid-session; without it, `SetModel` is refused once it has a cursor. */
  readonly switchModel: boolean;
}

const recordOf = (snapshot: ModelSnapshot): SessionRecord | undefined =>
  snapshot.machine.context.record ?? undefined;

export const stateOfModel = (snapshot: ModelSnapshot): SessionState | "new" =>
  stateOf(snapshot.machine);

/** Where the fake reports come from: the running Harness, or the followed terminal UI. */
export const channelOf = (
  snapshot: ModelSnapshot,
  options: ModelOptions
): "harness" | "follower" | null =>
  snapshot.live
    ? "harness"
    : stateOfModel(snapshot) === "in-terminal" && !options.liveCoAttach
      ? "follower"
      : null;

const newSession = (harness: HarnessKind, state: SessionState): AgentSession =>
  new AgentSession({
    id: SESSION,
    workspaceId: WorkspaceId.make("ws-model"),
    harness,
    title: "model",
    cwd: "/model",
    worktreeId: null,
    state,
    permissionMode: "supervised",
    model: null,
    effort: null,
    parentSessionId: null,
    forkedFromTurnId: null,
    harnessCursor: null,
    turnCount: 0,
    lastError: null,
    createdAt: AT,
    updatedAt: AT,
  });

const newTurn = (id: string, index: number): Turn =>
  new Turn({
    id: TurnId.make(id),
    sessionId: SESSION,
    index,
    prompt: "model",
    attachments: [],
    model: null,
    effort: null,
    status: "working",
    checkpointBefore: null,
    checkpointAfter: null,
    startedAt: AT,
    endedAt: null,
  });

/** What a Step's inputs are built from: the model's state before it. */
interface StepContext {
  readonly snapshot: ModelSnapshot;
  readonly options: ModelOptions;
  readonly record: SessionRecord | undefined;
  /** For fresh ids. */
  readonly n: number;
  readonly turnCount: number;
  readonly working: Turn | undefined;
  readonly channel: "harness" | "follower" | null;
}

type Inputs = ReadonlyArray<SessionInput>;

const approvalRequest = (id: string, turnId: TurnId, title: string) =>
  new ApprovalRequest({
    id: RequestId.make(id),
    sessionId: SESSION,
    turnId,
    kind: "command",
    title,
    detail: null,
    options: [],
    openedAt: AT,
  });

const firstPending = (record: SessionRecord | undefined) => {
  const [first] = record?.pending.keys() ?? [];

  return first;
};

const turnEnded = (c: StepContext, completed: boolean): Inputs =>
  c.channel === null || c.working === undefined
    ? []
    : [
        {
          type: "harness.turnEnded",
          turnId: c.working.id,
          status: completed ? "completed" : "failed",
          error: completed ? null : "the Turn failed",
          checkpoint: null,
          at: AT,
        },
      ];

const exited = (c: StepContext, error: string | null): Inputs =>
  c.snapshot.live ? [{ type: "harness.exited", error, at: AT }] : [];

/** A Turn typed in the Harness's own UI: the co-attached TUI, or the followed one. */
const terminalTurn = (c: StepContext): Inputs => {
  const state = stateOfModel(c.snapshot);
  const typedThere = state === "in-terminal" || (c.options.liveCoAttach && state === "idle");

  return c.channel === null || c.working !== undefined || !typedThere
    ? []
    : [{ type: "harness.turnStarted", turnId: TurnId.make(`tui${c.n}`), prompt: "tui", at: AT }];
};

/** The machine inputs of each Step, given the model's state; empty if the Step can't happen. */
const INPUTS = {
  start: (c) => [
    {
      type: "session.start",
      session: newSession(c.options.harness, "starting"),
      turn: newTurn(`t${c.n}`, 0),
    },
  ],
  fork: (c) => [{ type: "session.fork", session: newSession(c.options.harness, "dormant") }],
  send: (c) => [{ type: "turn.send", turn: newTurn(`t${c.n}`, c.turnCount) }],
  continue: () => [{ type: "turn.continue" }],
  interrupt: () => [{ type: "turn.interrupt" }],
  approve: (c) => {
    const first = firstPending(c.record);

    return first === undefined
      ? []
      : [
          {
            type: "approval.respond",
            requestId: first,
            decision: ApprovalDecision.cases.Allow.make({ remember: false }),
            resolvedBy: "model",
          },
        ];
  },
  archive: () => [{ type: "session.archive", at: AT }],
  unarchive: () => [{ type: "session.unarchive" }],
  openTerminal: () => [{ type: "terminal.open" }],
  returnTerminal: () => [{ type: "terminal.return" }],
  setModel: (c) => [
    { type: "model.set", model: `m${c.n}`, effort: null, canSwitchModel: c.options.switchModel },
  ],
  requestApproval: (c) =>
    c.channel === null || c.working === undefined || (c.record?.pending.size ?? 0) >= 2
      ? []
      : [
          {
            type: "harness.approvalRequested",
            request: approvalRequest(`r${c.n}`, c.working.id, "model"),
          },
        ],
  lateApproval: (c) => {
    const ended = c.record?.turns.findLast((t) => t.status !== "working");

    return c.channel === null || ended === undefined
      ? []
      : [
          {
            type: "harness.approvalRequested",
            request: approvalRequest(`r${c.n}`, ended.id, "late"),
          },
        ];
  },
  withdrawApproval: (c) => {
    const first = firstPending(c.record);

    return c.channel === null || first === undefined
      ? []
      : [{ type: "harness.approvalWithdrawn", requestId: first }];
  },
  terminalTurn,
  complete: (c) => turnEnded(c, true),
  failTurn: (c) => turnEnded(c, false),
  exit: (c) => exited(c, null),
  crash: (c) => exited(c, "boom"),
  restart: (c) =>
    c.record === undefined ? [] : [{ type: "daemon.recover", cause: "restart", at: AT }],
} satisfies { readonly [K in Step["type"]]: (c: StepContext) => Inputs };

const inputsOf = (snapshot: ModelSnapshot, step: Step, options: ModelOptions): Inputs => {
  const record = recordOf(snapshot);

  if (record === undefined && step.type !== "start" && step.type !== "fork") return [];

  return INPUTS[step.type]({
    snapshot,
    options,
    record,
    n: snapshot.counter,
    turnCount: record?.session.turnCount ?? 0,
    working: record && workingTurn(record),
    channel: channelOf(snapshot, options),
  });
};

/** The model after a Step, or the reason the machine refused it. */
export interface ModelStep {
  readonly next: ModelSnapshot;
  readonly rejection: string | null;
}

/** A Step against the model: its inputs, then what the Engine does on its own. */
export const stepModel = (
  snapshot: ModelSnapshot,
  step: Step,
  options: ModelOptions
): ModelStep => {
  const inputs = inputsOf(snapshot, step, options);

  if (inputs.length === 0) return { next: snapshot, rejection: null };
  let machine = snapshot.machine;
  let live = snapshot.live;

  const run = (input: SessionInput) => {
    const decision = decideSession(machine.context.record ?? undefined, input);
    machine = decision.next;

    return decision;
  };

  for (const input of inputs) {
    const decision = run(input);

    if (decision.rejection !== null) return { next: snapshot, rejection: decision.rejection };
  }

  const record = () => machine.context.record!;

  // What the Engine does after the step, on its own.
  switch (step.type) {
    case "start":
    case "send":
    case "continue":
      // The reactor opens (or reuses) the Harness and hands it the Turn.
      live = true;
      run({ type: "harness.opened" });
      break;
    case "interrupt":
      if (live) {
        // The fake Harness answers an interrupt by ending the Turn.
        run({
          type: "harness.turnEnded",
          turnId: workingTurn(record())!.id,
          status: "interrupted",
          error: null,
          checkpoint: null,
          at: AT,
        });
      } else {
        run({ type: "turn.interruptUnattended", at: AT });
      }

      break;
    case "openTerminal":
      // Codex's TUI co-attaches to the running Harness; Claude's takes over from it.
      live = options.liveCoAttach;
      break;
    case "returnTerminal":
      if (!options.liveCoAttach) run({ type: "terminal.closed", at: AT });
      live = true;
      run({ type: "harness.resumed" });
      break;
    case "archive":
    case "exit":
    case "crash":
    case "restart":
      live = false;
      break;
  }

  return { next: { ...snapshot, machine, live, counter: snapshot.counter + 1 }, rejection: null };
};

export const ALL_STEPS: ReadonlyArray<Step> = [
  { type: "start" },
  { type: "fork" },
  ...COMMAND_STEPS.map((type) => ({ type })),
  { type: "requestApproval" },
  { type: "lateApproval" },
  { type: "withdrawApproval" },
  { type: "terminalTurn" },
  { type: "complete" },
  { type: "failTurn" },
  { type: "exit" },
  { type: "crash" },
  { type: "restart" },
];

/** The abstract state compared with the Engine: what a Client can see of the session. */
export interface Observed {
  readonly state: SessionState | "new";
  readonly working: boolean;
  readonly last: Turn["status"] | null;
  readonly pending: number;
  readonly live: boolean;
}

export const observe = (record: SessionRecord | undefined, live: boolean): Observed => ({
  state: record?.session.state ?? "new",
  working: record !== undefined && workingTurn(record) !== undefined,
  last: (record && lastTurn(record)?.status) ?? null,
  pending: record?.pending.size ?? 0,
  live,
});

export const observeModel = (snapshot: ModelSnapshot): Observed =>
  observe(recordOf(snapshot), snapshot.live);

export const serialize = (snapshot: ModelSnapshot): string =>
  JSON.stringify(observeModel(snapshot));

const initialModel: ModelSnapshot = {
  status: "active",
  output: undefined,
  error: undefined,
  machine: snapshotOf(undefined),
  live: false,
  counter: 0,
};

export const initialSnapshot = (): ModelSnapshot => initialModel;

/** The model as actor logic, for `xstate/graph`'s traversals. */
export const modelLogic = (options: ModelOptions): ActorLogic<ModelSnapshot, Step> => ({
  transition: (snapshot: ModelSnapshot, step: Step) => [
    stepModel(snapshot, step, options).next,
    [],
  ],
  initialTransition: () => [initialModel, []],
  getInitialSnapshot: () => initialModel,
  getPersistedSnapshot: (snapshot: ModelSnapshot) => snapshot,
});

const traversal: TraversalOptions<ModelSnapshot, Step, unknown> = {
  events: [...ALL_STEPS],
  serializeState: serialize,
};

/**
 * The paths to test, generated from the model: one shortest path to every
 * state, and one path per state-changing transition (the shortest path to its
 * source, then the transition).
 */
export const pathsFor = (options: ModelOptions) => {
  const logic = modelLogic(options);

  const shortest = getShortestPaths(logic, traversal);

  // Steps start with xstate.init.
  const stepsOf = (path: (typeof shortest)[number]) => path.steps.slice(1).map((s) => s.event);
  const toState = new Map(shortest.map((path) => [serialize(path.state), stepsOf(path)]));

  const edges = adjacencyMapToArray(getAdjacencyMap(logic, traversal));
  const transitions: Array<ReadonlyArray<Step>> = [];

  for (const { state, event, nextState } of edges) {
    const key = serialize(state);

    if (serialize(nextState) !== key) transitions.push([...toState.get(key)!, event]);
  }

  return { states: shortest.map(stepsOf), transitions };
};
