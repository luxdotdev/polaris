/**
 * A test model over the session machine for `xstate/graph`: abstract Steps a
 * test can also drive against the real Engine (a Client command, something
 * the fake Harness reports, a Daemon restart), each followed by what the
 * Engine then does on its own (opening the Harness for a Turn, resuming it
 * after the terminal, the fake's reply to an interrupt). Not used in production.
 */
import {
  AgentSession,
  ApprovalRequest,
  type HarnessKind,
  RequestId,
  SessionId,
  type SessionState,
  Turn,
  TurnId,
  WorkspaceId,
} from "@polaris/protocol"
import type { AnyActorLogic } from "xstate"
import { getAdjacencyMap, getShortestPaths, type TraversalOptions } from "xstate/graph"
import { lastTurn, type SessionRecord, workingTurn } from "../store/model.ts"
import {
  decideSession,
  type SessionInput,
  type SessionSnapshot,
  snapshotOf,
  stateOf,
} from "./session.ts"

export const AT = "2026-01-01T00:00:00.000Z"
export const SESSION = SessionId.make("s-model")

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
  | { readonly type: "restart" }

export const COMMAND_STEPS = [
  "send",
  "continue",
  "interrupt",
  "approve",
  "archive",
  "unarchive",
  "openTerminal",
  "returnTerminal",
] as const satisfies ReadonlyArray<Step["type"]>

export interface ModelSnapshot {
  readonly status: "active"
  readonly output: undefined
  readonly error: undefined
  readonly machine: SessionSnapshot
  /** A Harness process of this session is running (the Engine's `live` map). */
  readonly live: boolean
  /** Ids handed out so far, so every Turn and request is new. */
  readonly counter: number
}

export interface ModelOptions {
  readonly harness: HarnessKind
  /** Codex: the TUI co-attaches to the running Harness. Claude: sequential hand-off. */
  readonly liveCoAttach: boolean
}

const recordOf = (snapshot: ModelSnapshot): SessionRecord | undefined =>
  snapshot.machine.context.record ?? undefined

export const stateOfModel = (snapshot: ModelSnapshot): SessionState | "new" =>
  stateOf(snapshot.machine)

/** Where the fake reports come from: the running Harness, or the followed terminal UI. */
export const channelOf = (
  snapshot: ModelSnapshot,
  options: ModelOptions,
): "harness" | "follower" | null =>
  snapshot.live
    ? "harness"
    : stateOfModel(snapshot) === "in-terminal" && !options.liveCoAttach
      ? "follower"
      : null

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
    parentSessionId: null,
    forkedFromTurnId: null,
    harnessCursor: null,
    turnCount: 0,
    lastError: null,
    createdAt: AT,
    updatedAt: AT,
  })

const newTurn = (id: string, index: number): Turn =>
  new Turn({
    id: TurnId.make(id),
    sessionId: SESSION,
    index,
    prompt: "model",
    attachments: [],
    status: "working",
    checkpointBefore: null,
    checkpointAfter: null,
    startedAt: AT,
    endedAt: null,
  })

/** The machine inputs a Step is, given the model's state; empty if the Step can't happen. */
const inputsOf = (
  snapshot: ModelSnapshot,
  step: Step,
  options: ModelOptions,
): ReadonlyArray<SessionInput> => {
  const record = recordOf(snapshot)
  const n = snapshot.counter
  const turnCount = record?.session.turnCount ?? 0
  const working = record && workingTurn(record)
  const channel = channelOf(snapshot, options)
  if (record === undefined && step.type !== "start" && step.type !== "fork") return []
  switch (step.type) {
    case "start":
      return [
        {
          type: "session.start",
          session: newSession(options.harness, "starting"),
          turn: newTurn(`t${n}`, 0),
        },
      ]
    case "fork":
      return [{ type: "session.fork", session: newSession(options.harness, "dormant") }]
    case "send":
      return [{ type: "turn.send", turn: newTurn(`t${n}`, turnCount) }]
    case "continue":
      return [{ type: "turn.continue" }]
    case "interrupt":
      return [{ type: "turn.interrupt" }]
    case "approve": {
      const [first] = record?.pending.keys() ?? []
      return first === undefined
        ? []
        : [
            {
              type: "approval.respond",
              requestId: first,
              decision: { _tag: "Allow", remember: false },
              resolvedBy: "model",
            },
          ]
    }
    case "archive":
      return [{ type: "session.archive" }]
    case "unarchive":
      return [{ type: "session.unarchive" }]
    case "openTerminal":
      return [{ type: "terminal.open" }]
    case "returnTerminal":
      return [{ type: "terminal.return" }]
    case "requestApproval":
      return channel === null || working === undefined || (record?.pending.size ?? 0) >= 2
        ? []
        : [
            {
              type: "harness.approvalRequested",
              request: new ApprovalRequest({
                id: RequestId.make(`r${n}`),
                sessionId: SESSION,
                turnId: working.id,
                kind: "command",
                title: "model",
                detail: null,
                options: [],
                openedAt: AT,
              }),
            },
          ]
    case "lateApproval": {
      const ended = record?.turns.findLast((t) => t.status !== "working")
      return channel === null || ended === undefined
        ? []
        : [
            {
              type: "harness.approvalRequested",
              request: new ApprovalRequest({
                id: RequestId.make(`r${n}`),
                sessionId: SESSION,
                turnId: ended.id,
                kind: "command",
                title: "late",
                detail: null,
                options: [],
                openedAt: AT,
              }),
            },
          ]
    }
    case "withdrawApproval": {
      const [first] = record?.pending.keys() ?? []
      return channel === null || first === undefined
        ? []
        : [{ type: "harness.approvalWithdrawn", requestId: first }]
    }
    case "terminalTurn":
      // A Turn typed in the Harness's own UI: the co-attached TUI, or the followed one.
      return channel === null ||
        working !== undefined ||
        !(
          stateOfModel(snapshot) === "in-terminal" ||
          (options.liveCoAttach && stateOfModel(snapshot) === "idle")
        )
        ? []
        : [{ type: "harness.turnStarted", turnId: TurnId.make(`tui${n}`), prompt: "tui", at: AT }]
    case "complete":
    case "failTurn":
      return channel === null || working === undefined
        ? []
        : [
            {
              type: "harness.turnEnded",
              turnId: working.id,
              status: step.type === "complete" ? "completed" : "failed",
              error: step.type === "complete" ? null : "the Turn failed",
              checkpoint: null,
              at: AT,
            },
          ]
    case "exit":
    case "crash":
      return snapshot.live
        ? [{ type: "harness.exited", error: step.type === "exit" ? null : "boom", at: AT }]
        : []
    case "restart":
      return record === undefined ? [] : [{ type: "daemon.recover", cause: "restart", at: AT }]
  }
}

/** A Step against the model: its inputs, then what the Engine does on its own. */
export const stepModel = (
  snapshot: ModelSnapshot,
  step: Step,
  options: ModelOptions,
): { readonly next: ModelSnapshot; readonly rejection: string | null } => {
  const inputs = inputsOf(snapshot, step, options)
  if (inputs.length === 0) return { next: snapshot, rejection: null }
  let machine = snapshot.machine
  let live = snapshot.live
  const run = (input: SessionInput) => {
    const decision = decideSession(machine.context.record ?? undefined, input)
    machine = decision.next
    return decision
  }
  for (const input of inputs) {
    const decision = run(input)
    if (decision.rejection !== null) return { next: snapshot, rejection: decision.rejection }
  }
  const record = () => machine.context.record!
  // What the Engine does after the step, on its own.
  switch (step.type) {
    case "start":
    case "send":
    case "continue":
      // The reactor opens (or reuses) the Harness and hands it the Turn.
      live = true
      run({ type: "harness.opened" })
      break
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
        })
      } else {
        run({ type: "turn.interruptUnattended", at: AT })
      }
      break
    case "openTerminal":
      // Codex's TUI co-attaches to the running Harness; Claude's takes over from it.
      live = options.liveCoAttach
      break
    case "returnTerminal":
      if (!options.liveCoAttach) run({ type: "terminal.closed", at: AT })
      live = true
      run({ type: "harness.resumed" })
      break
    case "archive":
    case "exit":
    case "crash":
    case "restart":
      live = false
      break
  }
  return { next: { ...snapshot, machine, live, counter: snapshot.counter + 1 }, rejection: null }
}

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
]

/** The abstract state compared with the Engine: what a Client can see of the session. */
export interface Observed {
  readonly state: SessionState | "new"
  readonly working: boolean
  readonly last: Turn["status"] | null
  readonly pending: number
  readonly live: boolean
}

export const observe = (record: SessionRecord | undefined, live: boolean): Observed => ({
  state: record?.session.state ?? "new",
  working: record !== undefined && workingTurn(record) !== undefined,
  last: (record && lastTurn(record)?.status) ?? null,
  pending: record?.pending.size ?? 0,
  live,
})

export const observeModel = (snapshot: ModelSnapshot): Observed =>
  observe(recordOf(snapshot), snapshot.live)

export const serialize = (snapshot: ModelSnapshot): string => JSON.stringify(observeModel(snapshot))

const initialModel: ModelSnapshot = {
  status: "active",
  output: undefined,
  error: undefined,
  machine: snapshotOf(undefined),
  live: false,
  counter: 0,
}

export const initialSnapshot = (): ModelSnapshot => initialModel

/** The model as actor logic, for `xstate/graph`'s traversals. */
export const modelLogic = (options: ModelOptions): AnyActorLogic => ({
  transition: (snapshot: ModelSnapshot, step: Step) => [
    stepModel(snapshot, step, options).next,
    [],
  ],
  initialTransition: () => [initialModel, []],
  getInitialSnapshot: () => initialModel,
  getPersistedSnapshot: (snapshot: ModelSnapshot) => snapshot,
})

const traversal = {
  events: ALL_STEPS,
  serializeState: serialize,
  // biome-ignore lint/suspicious/noExplicitAny: graph options are typed per logic; this one is ad hoc.
} as unknown as TraversalOptions<any, any, any>

/**
 * The paths to test, generated from the model: one shortest path to every
 * state, and one path per state-changing transition (the shortest path to its
 * source, then the transition).
 */
export const pathsFor = (options: ModelOptions) => {
  const logic = modelLogic(options)
  const shortest = getShortestPaths(logic, traversal) as unknown as ReadonlyArray<{
    readonly state: ModelSnapshot
    readonly steps: ReadonlyArray<{ readonly event: Step }>
  }>
  // Steps start with xstate.init.
  const stepsOf = (path: (typeof shortest)[number]) => path.steps.slice(1).map((s) => s.event)
  const toState = new Map(shortest.map((path) => [serialize(path.state), stepsOf(path)]))
  const adjacency = getAdjacencyMap(logic, traversal) as unknown as Record<
    string,
    {
      readonly transitions: Record<string, { readonly event: Step; readonly state: ModelSnapshot }>
    }
  >
  const transitions: Array<ReadonlyArray<Step>> = []
  for (const [key, vertex] of Object.entries(adjacency)) {
    for (const edge of Object.values(vertex.transitions)) {
      if (serialize(edge.state) !== key) transitions.push([...toState.get(key)!, edge.event])
    }
  }
  return { states: shortest.map(stepsOf), transitions }
}
