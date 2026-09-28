/**
 * Model-based tests generated from the session machine: `xstate/graph` walks
 * the test model (session.testing.ts) and every path it finds is replayed
 * against the real Engine with the fake Harness. After every step the Engine's
 * observed session (Session State, Turn in flight, last Turn status, pending
 * approvals, whether a Harness runs) must equal the model's; at the end of
 * each path, every command the machine refuses there must be refused by the
 * Engine with the same reason.
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import {
  type Command,
  CommandRejected,
  RequestId,
  SessionId,
  TurnId,
  type WorkspaceId,
} from "@polaris/protocol"
import { type Context, Effect, Exit, Layer, Scope } from "effect"
import type { HarnessEvent } from "../harness/HarnessDriver.ts"
import { EventStore } from "../store/EventStore.ts"
import { workingTurn } from "../store/model.ts"
import { Engine } from "./Engine.ts"
import {
  COMMAND_STEPS,
  channelOf,
  initialSnapshot,
  type ModelOptions,
  type ModelSnapshot,
  type Observed,
  observe,
  observeModel,
  pathsFor,
  SESSION,
  type Step,
  stepModel,
} from "./session.testing.ts"
import { cid, engineLayer, makeFakeDriver, makeFakes, tempDir } from "./testing.ts"

const PARENT = SessionId.make("s-parent")

type Env = Engine | EventStore

/** Replays `steps` against a fresh Engine, checking it against the model after each. */
const replay = (options: ModelOptions, steps: ReadonlyArray<Step>) =>
  Effect.gen(function* () {
    const driver = makeFakeDriver(options.harness, {
      liveCoAttach: options.liveCoAttach,
      follow: !options.liveCoAttach,
    })
    const layer = engineLayer({
      filename: join(tempDir(), "state.sqlite"),
      fakes: makeFakes(),
      drivers: [driver],
    })
    let scope = yield* Scope.make()
    let services: Context.Context<Env> = yield* Layer.buildWithScope(layer, scope)
    const inEngine = <A, E>(effect: Effect.Effect<A, E, Env>) => Effect.provide(effect, services)

    const dispatch = (command: Command) =>
      inEngine(
        Effect.flatMap(Engine, (engine) =>
          engine.dispatch({ commandId: cid("model"), command, deviceLabel: "model" }),
        ),
      )
    const record = () =>
      inEngine(Effect.map(EventStore, (store) => store)).pipe(
        Effect.flatMap((store) => store.model),
        Effect.map((model) => model.sessions.get(SESSION)),
      )
    const harnessLive = (sessionId = SESSION) => {
      const latest = driver.latest(sessionId)
      return latest !== undefined && !latest.closed
    }
    const observed = () => Effect.map(record(), (r) => observe(r, harnessLive()))

    /** Wait for the Engine to show `expected` (its reactors run after the ack). */
    const settle = (expected: Observed, done: ReadonlyArray<Step>) =>
      Effect.gen(function* () {
        const deadline = Date.now() + 3000
        while (true) {
          const actual = yield* observed()
          if (Bun.deepEquals(actual, expected)) return
          if (Date.now() > deadline) {
            return yield* Effect.die(
              new Error(
                `after ${done.map((s) => s.type).join(" → ")}: the Engine shows ${JSON.stringify(actual)}, the machine ${JSON.stringify(expected)}`,
              ),
            )
          }
          yield* Effect.sleep(2)
        }
      })

    // A Workspace (not a git repository: no checkpoints or Worktrees to fake).
    yield* dispatch({ _tag: "RegisterWorkspace", path: tempDir(), name: null })
    const workspaceId: WorkspaceId = yield* inEngine(
      Effect.flatMap(EventStore, (store) => store.model),
    ).pipe(Effect.map((model) => [...model.workspaces.keys()][0]!))

    const start = (sessionId: SessionId) =>
      dispatch({
        _tag: "StartSession",
        sessionId,
        workspaceId,
        harness: options.harness,
        placement: { _tag: "InPlace" },
        permissionMode: "supervised",
        model: null,
        prompt: "model",
        attachments: [],
      })

    const emit = (snapshot: ModelSnapshot, ...events: ReadonlyArray<HarnessEvent>) => {
      const channel = channelOf(snapshot, options)
      if (channel === "harness") driver.latest(SESSION)!.emit(...events)
      else if (channel === "follower") driver.follow.emit(SESSION, ...events)
      else throw new Error("no channel to the Harness")
    }
    const working = () =>
      Effect.map(record(), (r) => {
        const turn = r && workingTurn(r)
        if (turn === undefined) throw new Error("no Turn in flight")
        return turn.id
      })
    const firstPending = () =>
      Effect.map(record(), (r) => [...(r?.pending.keys() ?? [])][0] ?? RequestId.make("none"))

    const drive = (snapshot: ModelSnapshot, step: Step) =>
      Effect.gen(function* () {
        const n = snapshot.counter
        switch (step.type) {
          case "start":
            return yield* start(SESSION)
          case "fork": {
            yield* start(PARENT)
            yield* Effect.gen(function* () {
              while (!harnessLive(PARENT)) yield* Effect.sleep(2)
            })
            const parent = yield* inEngine(Effect.flatMap(EventStore, (store) => store.model)).pipe(
              Effect.map((model) => model.sessions.get(PARENT)!),
            )
            const turnId = workingTurn(parent)!.id
            driver
              .latest(PARENT)!
              .emit({ _tag: "TurnEnded", turnId, status: "completed", error: null })
            yield* Effect.gen(function* () {
              while (true) {
                const model = yield* inEngine(Effect.flatMap(EventStore, (store) => store.model))
                if (model.sessions.get(PARENT)?.session.state === "idle") return
                yield* Effect.sleep(2)
              }
            })
            return yield* dispatch({
              _tag: "ForkSession",
              sessionId: SESSION,
              fromSessionId: PARENT,
              fromTurnId: turnId,
              harness: options.harness,
            })
          }
          case "send":
            return yield* dispatch({
              _tag: "SendTurn",
              sessionId: SESSION,
              prompt: "model",
              attachments: [],
            })
          case "continue":
            return yield* dispatch({ _tag: "Continue", sessionId: SESSION })
          case "interrupt": {
            yield* dispatch({ _tag: "Interrupt", sessionId: SESSION })
            // The fake Harness answers an interrupt by ending the Turn.
            if (snapshot.live) {
              const turnId = yield* working()
              emit(snapshot, { _tag: "TurnEnded", turnId, status: "interrupted", error: null })
            }
            return
          }
          case "approve":
            return yield* dispatch({
              _tag: "RespondToApproval",
              sessionId: SESSION,
              requestId: yield* firstPending(),
              decision: { _tag: "Allow", remember: false },
            })
          case "archive":
            return yield* dispatch({
              _tag: "ArchiveSession",
              sessionId: SESSION,
              deleteMergedBranch: false,
            })
          case "unarchive":
            return yield* dispatch({ _tag: "UnarchiveSession", sessionId: SESSION })
          case "openTerminal":
            return yield* dispatch({ _tag: "OpenInTerminal", sessionId: SESSION })
          case "returnTerminal":
            return yield* dispatch({ _tag: "ReturnFromTerminal", sessionId: SESSION })
          case "requestApproval":
            return emit(snapshot, {
              _tag: "ApprovalRequested",
              turnId: yield* working(),
              requestId: RequestId.make(`r${n}`),
              kind: "command",
              title: "model",
              detail: null,
              options: [],
            })
          case "withdrawApproval":
            return emit(snapshot, { _tag: "ApprovalWithdrawn", requestId: yield* firstPending() })
          case "terminalTurn":
            return emit(snapshot, {
              _tag: "TurnStarted",
              turnId: TurnId.make(`tui${n}`),
              prompt: "tui",
            })
          case "complete":
          case "failTurn":
            return emit(snapshot, {
              _tag: "TurnEnded",
              turnId: yield* working(),
              status: step.type === "complete" ? "completed" : "failed",
              error: step.type === "complete" ? null : "the Turn failed",
            })
          case "exit":
          case "crash":
            return driver
              .latest(SESSION)!
              .emit({ _tag: "Exited", error: step.type === "exit" ? null : "boom" })
          case "restart":
            yield* Scope.close(scope, Exit.void)
            scope = yield* Scope.make()
            services = yield* Layer.buildWithScope(layer, scope)
            return
        }
      })

    let snapshot = initialSnapshot()
    const done: Array<Step> = []
    for (const step of steps) {
      const { next, rejection } = stepModel(snapshot, step, options)
      expect(rejection).toBeNull()
      yield* drive(snapshot, step)
      done.push(step)
      snapshot = next
      yield* settle(observeModel(snapshot), done)
    }

    // Every command the machine refuses here, the Engine refuses, for the same reason.
    let refused = 0
    for (const type of COMMAND_STEPS) {
      const { rejection } = stepModel(snapshot, { type }, options)
      if (rejection === null) continue
      const result = yield* drive(snapshot, { type }).pipe(Effect.flip)
      expect(result).toBeInstanceOf(CommandRejected)
      expect((result as CommandRejected).reason).toBe(rejection)
      refused++
    }
    yield* settle(observeModel(snapshot), done)
    yield* Scope.close(scope, Exit.void)
    return refused
  })

const suites: ReadonlyArray<ModelOptions> = [
  { harness: "claude", liveCoAttach: false },
  { harness: "codex", liveCoAttach: true },
]

for (const options of suites) {
  const paths = pathsFor(options)
  const handOff = options.liveCoAttach ? "live co-attach" : "sequential hand-off"
  describe(`session machine vs Engine: ${options.harness} (${handOff})`, () => {
    test(`${paths.states.length} shortest paths, one to every state`, async () => {
      let refused = 0
      for (const steps of paths.states) {
        refused += await Effect.runPromise(replay(options, steps))
      }
      expect(refused).toBeGreaterThan(0)
    }, 120_000)

    test(`${paths.transitions.length} transition paths, one per state-changing transition`, async () => {
      const queue = [...paths.transitions]
      // A few Engines at a time: each is its own SQLite file and fake Harness.
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          while (queue.length > 0) {
            const steps = queue.shift()!
            await Effect.runPromise(replay(options, steps))
          }
        }),
      )
    }, 300_000)
  })
}
