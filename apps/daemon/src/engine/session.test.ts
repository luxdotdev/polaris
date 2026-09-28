import { describe, expect, test } from "bun:test"
import type { SessionState } from "@polaris/protocol"
import { getAdjacencyMap } from "xstate/graph"
import { workingTurn } from "../store/model.ts"
import {
  ALL_STEPS,
  AT,
  initialSnapshot,
  type ModelOptions,
  type ModelSnapshot,
  modelLogic,
  pathsFor,
  type Step,
  serialize,
  stepModel,
} from "./session.testing.ts"
import { decideSession, snapshotOf, stateOf } from "./session.ts"

const claude: ModelOptions = { harness: "claude", liveCoAttach: false }
const codex: ModelOptions = { harness: "codex", liveCoAttach: true }

const run = (steps: ReadonlyArray<Step["type"]>, options = claude): ModelSnapshot => {
  let snapshot = initialSnapshot()
  for (const type of steps) {
    const { next, rejection } = stepModel(snapshot, { type }, options)
    if (rejection !== null) throw new Error(`${type}: ${rejection}`)
    snapshot = next
  }
  return snapshot
}

const record = (snapshot: ModelSnapshot) => snapshot.machine.context.record!

/** Every snapshot the model reaches, with every Step tried from it. */
const everyEdge = (options: ModelOptions) => {
  const adjacency = getAdjacencyMap(modelLogic(options), {
    events: ALL_STEPS as never,
    serializeState: serialize as never,
  }) as unknown as Record<string, { readonly state: ModelSnapshot }>
  return Object.values(adjacency).map((vertex) => vertex.state)
}

describe("session machine", () => {
  test("reaches all eight Session States", () => {
    for (const options of [claude, codex]) {
      const states = new Set(everyEdge(options).map((s) => stateOf(s.machine)))
      expect([...states].sort() as Array<string>).toEqual(
        [
          "new",
          "starting",
          "working",
          "needs-you",
          "idle",
          "in-terminal",
          "dormant",
          "failed",
          "archived",
        ]
          .filter((s) => s !== "starting") // transient: the Engine opens the Harness at once
          .sort(),
      )
    }
  })

  test("every snapshot is the one its folded record gives (a restart derives the same)", () => {
    for (const options of [claude, codex]) {
      for (const snapshot of everyEdge(options)) {
        for (const step of ALL_STEPS) {
          const { next } = stepModel(snapshot, step, options)
          const rebuilt = snapshotOf(next.machine.context.record ?? undefined)
          expect(rebuilt.value).toEqual(next.machine.value)
          expect(stateOf(next.machine)).toBe(next.machine.context.record?.session.state ?? "new")
        }
      }
    }
  })

  test("graph path counts", () => {
    const counts = [claude, codex].map((options) => {
      const paths = pathsFor(options)
      return [paths.states.length, paths.transitions.length]
    })
    // Update README.md when these move.
    expect(counts).toEqual([
      [35, 149],
      [41, 196],
    ])
  })

  describe("guards", () => {
    const refusal = (snapshot: ModelSnapshot, type: Step["type"], options = claude) =>
      stepModel(snapshot, { type }, options).rejection

    test("no new Turn while one is in flight", () => {
      const working = run(["start"])
      expect(stateOf(working.machine)).toBe("working")
      expect(refusal(working, "send")).toBe("the session is working; wait for the Turn to end")
      const waiting = run(["start", "requestApproval"])
      expect(stateOf(waiting.machine)).toBe("needs-you")
      expect(refusal(waiting, "send")).toBe("the session is needs-you; wait for the Turn to end")
    })

    test("Continue only for an Interrupted Turn", () => {
      expect(refusal(run(["start", "complete"]), "continue")).toBe(
        "there is no Interrupted Turn to continue",
      )
      expect(refusal(run(["start", "interrupt"]), "continue")).toBeNull()
    })

    test("In Terminal and Archived take no Turns", () => {
      expect(refusal(run(["start", "complete", "openTerminal"]), "send")).toBe(
        "the session is In Terminal; return it first",
      )
      expect(refusal(run(["start", "complete", "archive"]), "send")).toBe("the session is Archived")
    })

    test("a live Turn must be interrupted before archiving", () => {
      expect(refusal(run(["start"]), "archive")).toBe(
        "interrupt the Turn in flight before archiving",
      )
      expect(refusal(run(["start", "complete", "archive"]), "archive")).toBe(
        "the session is already Archived",
      )
    })

    test("the terminal opens from Idle, Dormant or Failed only", () => {
      expect(refusal(run(["start"]), "openTerminal")).toBe("the session is working")
      for (const steps of [
        ["start", "complete"],
        ["start", "complete", "exit"],
        ["start", "failTurn"],
      ] as const) {
        expect(refusal(run(steps), "openTerminal")).toBeNull()
      }
    })
  })

  describe("restart recovery", () => {
    test("a Turn in flight is Interrupted and the session Needs You; nothing continues it", () => {
      const before = run(["start", "requestApproval"])
      const decision = decideSession(record(before), {
        type: "daemon.recover",
        cause: "restart",
        at: AT,
      })
      expect(decision.events.map((e) => e._tag)).toEqual([
        "TurnEnded",
        "ApprovalWithdrawn",
        "SessionStateChanged",
      ])
      const after = decision.next.context.record!
      expect(after.session.state).toBe("needs-you")
      expect(workingTurn(after)).toBeUndefined()
      expect(after.turns.at(-1)?.status).toBe("interrupted")
      // And again after another restart: still waiting on Continue.
      expect(
        decideSession(after, { type: "daemon.recover", cause: "restart", at: AT }).events,
      ).toEqual([])
    })

    test("Dormant and Archived sessions have nothing to recover", () => {
      for (const steps of [
        ["start", "complete", "exit"],
        ["start", "complete", "archive"],
      ] as const) {
        const decision = decideSession(record(run(steps)), {
          type: "daemon.recover",
          cause: "restart",
          at: AT,
        })
        expect(decision.events).toEqual([])
      }
    })

    test("an upgrade leaves a terminal UI alone", () => {
      const inTerminal = record(run(["start", "complete", "openTerminal"], codex))
      expect(
        decideSession(inTerminal, { type: "daemon.recover", cause: "upgrade", at: AT }).events,
      ).toEqual([])
    })
  })

  describe("effects", () => {
    test("entering Idle schedules the idle stop; the idle timeout stops the Harness", () => {
      const working = record(run(["start"]))
      const ended = decideSession(working, {
        type: "harness.turnEnded",
        turnId: workingTurn(working)!.id,
        status: "completed",
        error: null,
        checkpoint: null,
        at: AT,
      })
      expect(ended.effects).toEqual(["scheduleIdleStop"])
      const idle = ended.next.context.record!
      const timedOut = decideSession(idle, { type: "idle.timeout", harnessLive: true })
      expect(timedOut.effects).toEqual(["stopHarness"])
      expect(timedOut.next.context.record!.session.state satisfies SessionState).toBe("dormant")
      // A Harness that is already gone: nothing to do.
      expect(decideSession(idle, { type: "idle.timeout", harnessLive: false }).events).toEqual([])
    })
  })
})
