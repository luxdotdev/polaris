/**
 * Driving a Daemon like a Client does: dispatch commands, register Workspaces,
 * start scripted Agent Sessions, and watch session streams while recording
 * when things arrive.
 */
import {
  type Command,
  CommandId,
  type HarnessKind,
  type Sequence,
  SessionId,
  type SessionState,
  type WorkspaceId,
} from "@polaris/protocol"
import { Duration, Effect, type Scope, Stream } from "effect"
import type { Client } from "./daemon.ts"

/**
 * Mirrors `BenchTurnScript` in apps/daemon/src/harness/bench/BenchDriver.ts:
 * the scripted Harness reads it from a `bench:{json}` prompt.
 */
export interface TurnScript {
  readonly items?: number
  readonly deltasPerItem?: number
  readonly deltaBytes?: number
  readonly deltaIntervalMs?: number
  readonly approvalEvery?: number
  readonly touchFiles?: number
  readonly itemBytes?: number
  readonly startDelayMs?: number
}

export const prompt = (script: TurnScript) => `bench:${JSON.stringify(script)}`

let counter = 0
export const commandId = () => CommandId.make(`bench-${process.pid}-${++counter}`)

export const dispatch = (client: Client, command: Command) =>
  client.connection.client.dispatch({ commandId: commandId(), command })

/** Register `path` and return its Workspace id. */
export const registerWorkspace = (client: Client, path: string, name: string) =>
  Effect.gen(function* () {
    yield* dispatch(client, { _tag: "RegisterWorkspace", path, name })
    const snapshot = yield* client.connection.client.subscribeHost({ afterSequence: null }).pipe(
      Stream.filter((item) => item._tag === "Snapshot"),
      Stream.runHead,
    )
    const workspace =
      snapshot._tag === "Some" && snapshot.value._tag === "Snapshot"
        ? snapshot.value.workspaces.find((w) => w.name === name)
        : undefined
    if (workspace === undefined) return yield* Effect.die(new Error(`${name} not registered`))
    return workspace.id as WorkspaceId
  })

export const startSession = (
  client: Client,
  options: {
    readonly sessionId: string
    readonly workspaceId: WorkspaceId
    readonly script: TurnScript
    readonly harness?: HarnessKind
  },
) =>
  dispatch(client, {
    _tag: "StartSession",
    sessionId: SessionId.make(options.sessionId),
    workspaceId: options.workspaceId,
    harness: options.harness ?? "codex",
    placement: { _tag: "InPlace" },
    permissionMode: "supervised",
    model: null,
    prompt: prompt(options.script),
    attachments: [],
  })

export const sendTurn = (client: Client, sessionId: string, script: TurnScript) =>
  dispatch(client, {
    _tag: "SendTurn",
    sessionId: SessionId.make(sessionId),
    prompt: prompt(script),
    attachments: [],
  })

export interface SessionWatch {
  readonly sessionId: string
  state: SessionState | null
  /** Arrival time (performance.now) of each TurnStarted, in order. */
  readonly turnStarted: Array<number>
  /** Arrival time of each TurnEnded, in order. */
  readonly turnEnded: Array<number>
  events: number
  deltas: number
  deltaBytes: number
  lastSequence: number
  /** Sequence of each TurnEnded event, in order. */
  readonly turnEndedSequences: Array<number>
  /** Arrival times of CheckpointRecorded events, with their refs and the last item's arrival before. */
  readonly checkpoints: Array<{
    readonly at: number
    readonly ref: string
    readonly lastItemAt: number
  }>
  /** Arrival time of the last TurnItemCompleted. */
  lastItemAt: number
  snapshotAt: number | null
  synchronizedAt: number | null
  /** Items in the first snapshot. */
  snapshotTurns: number
}

export interface WatchOptions {
  /** Answer every approval with Allow (only one Client should). */
  readonly autoApprove?: boolean
  /** Harness emit → Client receive latency of every delta, ms. */
  readonly deltaLatencies?: Array<number>
  /** Commit → Client receive latency of every event, ms (1 ms resolution). */
  readonly eventLatencies?: Array<number>
  /** Approval request → resolution arrival, ms. */
  readonly approvalRoundTrips?: Array<number>
  readonly afterSequence?: number | null
  readonly turnLimit?: number | null
}

const nowEpoch = () => performance.timeOrigin + performance.now()

/** Subscribe to a session stream in the background; the returned object fills in as items arrive. */
export const watchSession = (
  client: Client,
  sessionId: string,
  options: WatchOptions = {},
): Effect.Effect<SessionWatch, never, Scope.Scope> =>
  Effect.gen(function* () {
    const watch: SessionWatch = {
      sessionId,
      state: null,
      turnStarted: [],
      turnEnded: [],
      events: 0,
      deltas: 0,
      deltaBytes: 0,
      lastSequence: 0,
      turnEndedSequences: [],
      checkpoints: [],
      lastItemAt: 0,
      snapshotAt: null,
      synchronizedAt: null,
      snapshotTurns: 0,
    }
    const approvalsOpened = new Map<string, number>()
    yield* client.connection.client
      .subscribeSession({
        sessionId: SessionId.make(sessionId),
        afterSequence: (options.afterSequence ?? null) as Sequence | null,
        turnLimit: options.turnLimit ?? null,
      })
      .pipe(
        Stream.runForEach((item) =>
          Effect.suspend(() => {
            const at = performance.now()
            switch (item._tag) {
              case "Snapshot":
                watch.snapshotAt ??= at
                watch.state = item.session.state
                watch.lastSequence = item.sequence
                watch.snapshotTurns = item.turns.length
                // Turns already in the snapshot count as started (and ended) on arrival.
                if (watch.turnStarted.length === 0) {
                  for (const detail of item.turns) {
                    watch.turnStarted.push(at)
                    if (detail.turn.status !== "working") watch.turnEnded.push(at)
                  }
                }
                return Effect.void
              case "Synchronized":
                watch.synchronizedAt ??= at
                return Effect.void
              case "Delta": {
                watch.deltas++
                watch.deltaBytes += item.text.length
                if (options.deltaLatencies && item.text.charCodeAt(0) === 64 /* @ */) {
                  const emitted = Number(item.text.slice(1, item.text.indexOf("|")))
                  if (emitted > 0) options.deltaLatencies.push(nowEpoch() - emitted)
                }
                return Effect.void
              }
              case "Event": {
                watch.events++
                watch.lastSequence = item.envelope.sequence
                options.eventLatencies?.push(Date.now() - Date.parse(item.envelope.occurredAt))
                const event = item.envelope.event
                switch (event._tag) {
                  case "SessionStateChanged":
                    watch.state = event.state
                    return Effect.void
                  case "TurnStarted":
                    watch.turnStarted.push(at)
                    return Effect.void
                  case "TurnEnded":
                    watch.turnEnded.push(at)
                    watch.turnEndedSequences.push(item.envelope.sequence)
                    return Effect.void
                  case "TurnItemCompleted":
                    watch.lastItemAt = at
                    return Effect.void
                  case "CheckpointRecorded":
                    watch.checkpoints.push({ at, ref: event.ref, lastItemAt: watch.lastItemAt })
                    return Effect.void
                  case "ApprovalRequested":
                    approvalsOpened.set(event.request.id, at)
                    return options.autoApprove
                      ? dispatch(client, {
                          _tag: "RespondToApproval",
                          sessionId: event.request.sessionId,
                          requestId: event.request.id,
                          decision: { _tag: "Allow", remember: false },
                        }).pipe(Effect.ignore)
                      : Effect.void
                  case "ApprovalResolved": {
                    const opened = approvalsOpened.get(event.requestId)
                    if (opened !== undefined) options.approvalRoundTrips?.push(at - opened)
                    return Effect.void
                  }
                  default:
                    return Effect.void
                }
              }
              default:
                // ItemProgress and any later live-only items: not measured here.
                return Effect.void
            }
          }),
        ),
        Effect.ignore,
        Effect.forkScoped,
      )
    return watch
  })

/** Poll `condition` every 5 ms until it holds. */
export const waitUntil = (condition: () => boolean, timeoutMs: number, what: string) =>
  Effect.gen(function* () {
    const deadline = performance.now() + timeoutMs
    while (!condition()) {
      if (performance.now() > deadline) {
        return yield* Effect.fail(new Error(`timed out after ${timeoutMs} ms waiting for ${what}`))
      }
      yield* Effect.sleep(Duration.millis(5))
    }
  })

export const settle = (ms: number) => Effect.sleep(Duration.millis(ms))
