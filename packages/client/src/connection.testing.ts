/**
 * A test model over the Connection State machine for `xstate/graph`: abstract
 * Steps a test can drive against a real HostConnection with a scripted
 * connector and a TestClock (the next attempt connects or fails with a given
 * reason, the connection drops, the user retries, time passes). The model
 * also tracks what the connection loop is doing (waiting on an attempt's
 * outcome, waiting to retry, connected), which the machine leaves to its
 * runner. Not used in production.
 */
import type { AnyActorLogic } from "xstate"
import { getAdjacencyMap, getShortestPaths, type TraversalOptions } from "xstate/graph"
import {
  type ConnectionSnapshot,
  connectionMachine,
  initialConnection,
  type ReconnectPolicy,
} from "./connection.ts"
import { ConnectFailure } from "./failures.ts"

/** Delays far apart, and no jitter, so each Step has one outcome. */
export const MODEL_POLICY: ReconnectPolicy = {
  initialDelayMs: 10_000,
  maxDelayMs: 80_000,
  factor: 2,
  jitter: 0,
  offlineAfterMs: 60_000,
  offlineRetryMs: 30_000,
  needsAttentionRetryMs: 20_000,
  helloTimeoutMs: 1_000_000_000,
  restartGraceMs: 5_000,
}

export const FAILURES = {
  timeout: new ConnectFailure({ kind: "transient", reason: "timeout", detail: "model" }),
  "daemon-not-running": new ConnectFailure({
    kind: "needs-attention",
    reason: "daemon-not-running",
    detail: "model",
  }),
  "auth-failed": new ConnectFailure({
    kind: "needs-attention",
    reason: "auth-failed",
    detail: "model",
  }),
  "polaris-not-installed": new ConnectFailure({
    kind: "needs-attention",
    reason: "polaris-not-installed",
    detail: "model",
  }),
} as const

/** What a connection that was up reports once it drops. */
export const LOST = new ConnectFailure({
  kind: "transient",
  reason: "connection-lost",
  detail: "model",
})

export type ConnectionStep =
  /** The pending attempt reaches the Daemon. */
  | { readonly type: "connect" }
  /** The pending attempt fails. */
  | { readonly type: "fail"; readonly reason: keyof typeof FAILURES }
  /** The live connection ends. */
  | { readonly type: "drop" }
  /** The user asks to try now. */
  | { readonly type: "retry" }
  /** The wait before the next attempt runs out. */
  | { readonly type: "elapse" }
  /** Time passes: the restart grace. */
  | { readonly type: "tick" }

export const CONNECTION_STEPS: ReadonlyArray<ConnectionStep> = [
  { type: "connect" },
  ...(Object.keys(FAILURES) as Array<keyof typeof FAILURES>).map((reason) => ({
    type: "fail" as const,
    reason,
  })),
  { type: "drop" },
  { type: "retry" },
  { type: "elapse" },
  { type: "tick" },
]

export interface ConnectionModel {
  readonly status: "active"
  readonly output: undefined
  readonly error: undefined
  readonly machine: ConnectionSnapshot
  /** What the connection loop is doing. */
  readonly phase: "attempting" | "waiting" | "live"
  /** The TestClock, in ms. */
  readonly clock: number
  /** When the loop started waiting (the last failure). */
  readonly failedAt: number
}

const initial: ConnectionModel = {
  status: "active",
  output: undefined,
  error: undefined,
  machine: initialConnection(MODEL_POLICY, 0),
  phase: "attempting",
  clock: 0,
  failedAt: 0,
}

export const initialConnectionModel = (): ConnectionModel => initial

/** The model after `step`; the same snapshot when the step can't happen. */
export const stepConnection = (model: ConnectionModel, step: ConnectionStep): ConnectionModel => {
  const { machine, phase, clock } = model
  const fail = (failure: ConnectFailure) => {
    const [next] = connectionMachine.transition(machine, {
      type: "failed",
      failure,
      now: clock,
      jitter: 0.5,
    })
    return {
      ...model,
      machine: next,
      phase: next.context.delay === 0 ? ("attempting" as const) : ("waiting" as const),
      failedAt: clock,
    }
  }
  switch (step.type) {
    case "connect":
      if (phase !== "attempting") return model
      return {
        ...model,
        machine: connectionMachine.transition(machine, {
          type: "connected",
          epoch: machine.context.epoch + 1,
        })[0],
        phase: "live",
      }
    case "fail":
      return phase === "attempting" ? fail(FAILURES[step.reason]) : model
    case "drop":
      return phase === "live" ? fail(LOST) : model
    case "retry":
      if (phase !== "waiting") return model
      return {
        ...model,
        machine: connectionMachine.transition(machine, { type: "retry" })[0],
        phase: "attempting",
      }
    case "elapse": {
      const delay = machine.context.delay
      if (phase !== "waiting" || delay === null) return model
      return { ...model, phase: "attempting", clock: clock + delay }
    }
    case "tick": {
      if (phase !== "waiting") return model
      const delay = machine.context.delay
      const passed = MODEL_POLICY.restartGraceMs
      return {
        ...model,
        clock: clock + passed,
        phase: delay !== null && passed >= delay ? "attempting" : "waiting",
      }
    }
  }
}

/** What the test compares with a real HostConnection. */
export interface ObservedConnection {
  readonly state: ConnectionSnapshot["value"]
  readonly attempt: number
  readonly failure: string | null
  /** ms from now until the next automatic attempt; null if none. */
  readonly nextAttemptIn: number | null
  readonly phase: ConnectionModel["phase"]
}

export const observeConnectionModel = (model: ConnectionModel): ObservedConnection => ({
  state: model.machine.value,
  attempt: model.machine.context.attempt,
  failure: model.machine.context.failure?.reason ?? null,
  nextAttemptIn:
    model.phase === "waiting" && model.machine.context.delay !== null
      ? model.machine.context.delay - (model.clock - model.failedAt)
      : null,
  phase: model.phase,
})

/** Serialize with bounded buckets, so the traversal is finite. */
export const serializeConnection = (model: ConnectionModel): string => {
  const { context, value } = model.machine
  const sinceLost = context.lostAt === null ? "never" : model.clock - context.lostAt
  return JSON.stringify({
    value,
    phase: model.phase,
    attempt: Math.min(context.attempt, 4),
    failure: context.failure?.reason ?? null,
    delay: context.delay,
    lost:
      sinceLost === "never"
        ? "never"
        : sinceLost < MODEL_POLICY.restartGraceMs
          ? "in-grace"
          : "after-grace",
    offline: model.clock - context.failingSince >= MODEL_POLICY.offlineAfterMs,
  })
}

export const connectionModelLogic: AnyActorLogic = {
  transition: (model: ConnectionModel, step: ConnectionStep) => [stepConnection(model, step), []],
  initialTransition: () => [initial, []],
  getInitialSnapshot: () => initial,
  getPersistedSnapshot: (model: ConnectionModel) => model,
} as AnyActorLogic

const traversal = {
  events: CONNECTION_STEPS,
  serializeState: serializeConnection,
  // biome-ignore lint/suspicious/noExplicitAny: graph options are typed per logic; this one is ad hoc.
} as unknown as TraversalOptions<any, any, any>

type Path = ReadonlyArray<ConnectionStep>

const stepsOf = (path: { readonly steps: ReadonlyArray<{ readonly event: unknown }> }): Path =>
  path.steps.slice(1).map((s) => s.event as ConnectionStep)

/**
 * The paths to test: one shortest path to every state, and one per
 * state-changing transition (the shortest path to its source, then it).
 * Simple paths (no state twice) are too many here to enumerate.
 */
export const connectionPaths = () => {
  const logic = connectionModelLogic
  const shortest = getShortestPaths(logic, traversal) as unknown as ReadonlyArray<{
    readonly state: ConnectionModel
    readonly steps: ReadonlyArray<{ readonly event: ConnectionStep }>
  }>
  const toState = new Map(shortest.map((path) => [serializeConnection(path.state), stepsOf(path)]))
  const adjacency = getAdjacencyMap(logic, traversal) as unknown as Record<
    string,
    {
      readonly transitions: Record<
        string,
        { readonly event: ConnectionStep; readonly state: ConnectionModel }
      >
    }
  >
  const transitions: Array<Path> = []
  for (const [key, vertex] of Object.entries(adjacency)) {
    for (const edge of Object.values(vertex.transitions)) {
      if (serializeConnection(edge.state) !== key) {
        transitions.push([...toState.get(key)!, edge.event])
      }
    }
  }
  return { states: shortest.map(stepsOf), transitions }
}
