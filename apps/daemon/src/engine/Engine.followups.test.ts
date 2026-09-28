/**
 * Engine behaviour added in ENG-194: prompts of Turns started outside Polaris,
 * live item progress, ApprovalWithdrawn, terminal hand-off (launch command,
 * following the TUI, the refreshed cursor), Forks in their own Worktree,
 * bounded live buffers, recent Turns in memory, and the upgrade hook.
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import {
  AgentSession,
  type Command,
  DomainEvent,
  type HarnessKind,
  type RequestId,
  type Sequence,
  type SessionId,
  type SessionStreamItem,
  Turn,
  type TurnId,
  type Workspace,
} from "@polaris/protocol"
import { Deferred, Duration, Effect, Fiber, type Layer, Stream } from "effect"
import { EventStore } from "../store/EventStore.ts"
import { RECENT_TURNS } from "../store/model.ts"
import { forkBranch } from "./decider.ts"
import { Engine } from "./Engine.ts"
import {
  cid,
  completesTurns,
  engineLayer,
  type FakeDriver,
  fakeRepo,
  makeFakeDriver,
  makeFakes,
  tempDir,
  waitFor,
  waitUntil,
} from "./testing.ts"

type Env = Engine | EventStore

const run = <A, E>(layer: Layer.Layer<Env>, program: Effect.Effect<A, E, Env>) =>
  Effect.runPromise(program.pipe(Effect.provide(layer)) as Effect.Effect<A, E>)

const sid = (s: string) => s as SessionId

const dispatch = (command: Command, deviceLabel = "MacBook") =>
  Effect.flatMap(Engine, (engine) => engine.dispatch({ commandId: cid(), command, deviceLabel }))

const registerWorkspace = Effect.gen(function* () {
  const repo = fakeRepo()
  yield* dispatch({ _tag: "RegisterWorkspace", path: repo, name: null })
  const model = yield* waitFor((m) => [...m.workspaces.values()].some((w) => w.path === repo))
  return [...model.workspaces.values()].find((w) => w.path === repo)!
})

const startSession = (
  workspace: Workspace,
  sessionId: SessionId,
  harness: HarnessKind = "claude",
  prompt = "Fix the flaky test",
) =>
  dispatch({
    _tag: "StartSession",
    sessionId,
    workspaceId: workspace.id,
    harness,
    placement: { _tag: "InPlace" },
    permissionMode: "supervised",
    model: null,
    prompt,
    attachments: [],
  })

const setup = (options: {
  drivers: ReadonlyArray<FakeDriver>
  idleTimeout?: Duration.Input
  subscriberCapacity?: number
}) => {
  const fakes = makeFakes()
  const filename = join(tempDir(), "state.sqlite")
  const layer = engineLayer({ filename, fakes, ...options })
  return { fakes, filename, layer }
}

/** Collect a stream's items in the background. */
const collect = <E>(stream: Stream.Stream<SessionStreamItem, E>) =>
  Effect.gen(function* () {
    const items: Array<SessionStreamItem> = []
    const fiber = yield* Stream.runForEach(stream, (item) =>
      Effect.sync(() => void items.push(item)),
    ).pipe(Effect.forkChild)
    yield* waitUntil(() => items.some((i) => i._tag === "Synchronized"))
    return { items, fiber }
  })

const eventTags = (items: ReadonlyArray<SessionStreamItem>) =>
  items.flatMap((i) => (i._tag === "Event" ? [i.envelope.event._tag] : []))

describe("Turns started outside Polaris", () => {
  test("a Turn typed in a co-attached TUI is recorded with its prompt", async () => {
    const codex = makeFakeDriver("codex", { liveCoAttach: true, onTurn: completesTurns("x1") })
    const { layer } = setup({ drivers: [codex] })
    await run(
      layer,
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace
        const s = sid("s-tui-prompt")
        yield* startSession(workspace, s, "codex")
        yield* waitFor((m) => m.sessions.get(s)?.session.state === "idle")
        const tuiTurn = "turn-from-tui" as TurnId
        codex
          .latest(s)!
          .emit(
            { _tag: "TurnStarted", turnId: tuiTurn, prompt: "also update the docs" },
            { _tag: "TurnEnded", turnId: tuiTurn, status: "completed", error: null },
          )
        const model = yield* waitFor(
          (m) => m.sessions.get(s)?.turns.find((t) => t.id === tuiTurn)?.status === "completed",
        )
        const record = model.sessions.get(s)!
        expect(record.turns.find((t) => t.id === tuiTurn)).toMatchObject({
          index: 1,
          prompt: "also update the docs",
        })
        expect(record.session.turnCount).toBe(2)
      }),
    )
  })
})

describe("live item progress", () => {
  test("progress is live-only; one completion is persisted; late subscribers see running items", async () => {
    const codex = makeFakeDriver("codex")
    const { layer } = setup({ drivers: [codex] })
    await run(
      layer,
      Effect.gen(function* () {
        const engine = yield* Engine
        const store = yield* EventStore
        const workspace = yield* registerWorkspace
        const s = sid("s-progress")
        yield* startSession(workspace, s, "codex")
        yield* waitFor((m) => m.sessions.get(s)?.session.state === "working")
        const harness = codex.latest(s)!
        const turnId = harness.turns[0]!.turnId
        const running = {
          _tag: "CommandExecution" as const,
          id: "c1",
          command: "bun test",
          cwd: workspace.path,
          output: "",
          exitCode: null,
          status: "running" as const,
        }
        const early = yield* collect(
          engine.subscribeSession({
            sessionId: s,
            afterSequence: null,
            turnLimit: null,
            liveItems: true,
          }),
        )
        const legacy = yield* collect(
          engine.subscribeSession({ sessionId: s, afterSequence: null, turnLimit: null }),
        )
        const before = (yield* store.model).sequence
        harness.emit(
          { _tag: "ItemUpdated", turnId, item: running },
          {
            _tag: "ItemUpdated",
            turnId,
            item: { _tag: "Plan", id: "p1", steps: [{ text: "test", status: "in-progress" }] },
          },
        )
        yield* waitUntil(() => early.items.filter((i) => i._tag === "ItemProgress").length === 2)
        // Nothing was persisted for progress.
        expect((yield* store.model).sequence).toBe(before)

        // A Client that subscribes mid-Turn gets the running items right after Synchronized.
        const late = yield* collect(
          engine.subscribeSession({
            sessionId: s,
            afterSequence: null,
            turnLimit: null,
            liveItems: true,
          }),
        )
        yield* waitUntil(() => late.items.filter((i) => i._tag === "ItemProgress").length === 2)
        const sync = late.items.findIndex((i) => i._tag === "Synchronized")
        expect(late.items[sync + 1]).toMatchObject({ _tag: "ItemProgress", item: { id: "c1" } })

        harness.emit(
          {
            _tag: "ItemCompleted",
            turnId,
            item: { ...running, output: "17 pass", exitCode: 0, status: "completed" },
          },
          { _tag: "TurnEnded", turnId, status: "completed", error: null },
        )
        yield* waitFor((m) => m.sessions.get(s)?.session.state === "idle")
        yield* waitUntil(() => eventTags(early.items).includes("TurnEnded"))
        // A Client that didn't announce `session.live-items` never gets ItemProgress.
        yield* waitUntil(() => eventTags(legacy.items).includes("TurnEnded"))
        expect(legacy.items.some((i) => i._tag === "ItemProgress")).toBe(false)
        expect(eventTags(early.items).filter((t) => t === "TurnItemCompleted")).toHaveLength(1)

        // Progress of items that never completed is gone once the Turn ended.
        const after = yield* collect(
          engine.subscribeSession({
            sessionId: s,
            afterSequence: null,
            turnLimit: null,
            liveItems: true,
          }),
        )
        yield* Effect.sleep(Duration.millis(20))
        expect(after.items.some((i) => i._tag === "ItemProgress")).toBe(false)
        const snapshot = after.items[0]!
        if (snapshot._tag !== "Snapshot") throw new Error("expected a snapshot")
        expect(snapshot.turns[0]!.items).toEqual([
          { ...running, output: "17 pass", exitCode: 0, status: "completed" },
        ])
        for (const f of [early, legacy, late, after]) yield* Fiber.interrupt(f.fiber)
      }),
    )
  })
})

describe("ApprovalWithdrawn", () => {
  test("a request the Harness withdraws is recorded as ApprovalWithdrawn", async () => {
    const codex = makeFakeDriver("codex")
    const { layer } = setup({ drivers: [codex] })
    await run(
      layer,
      Effect.gen(function* () {
        const store = yield* EventStore
        const workspace = yield* registerWorkspace
        const s = sid("s-withdrawn")
        yield* startSession(workspace, s, "codex")
        yield* waitFor((m) => m.sessions.get(s)?.session.state === "working")
        const harness = codex.latest(s)!
        const turnId = harness.turns[0]!.turnId
        const requestId = "req-1" as RequestId
        harness.emit({
          _tag: "ApprovalRequested",
          turnId,
          requestId,
          kind: "command",
          title: "Run tests",
          detail: null,
          options: [],
        })
        yield* waitFor((m) => m.sessions.get(s)?.session.state === "needs-you")
        harness.emit({ _tag: "ApprovalWithdrawn", requestId })
        const model = yield* waitFor((m) => m.sessions.get(s)?.session.state === "working")
        expect(model.sessions.get(s)!.pending.size).toBe(0)
        const events = yield* store.readEvents({ after: 0, upTo: model.sequence, sessionId: s })
        expect(events.map((e) => e.event._tag)).not.toContain("ApprovalResolved")
        expect(events.find((e) => e.event._tag === "ApprovalWithdrawn")?.event).toEqual(
          DomainEvent.cases.ApprovalWithdrawn.make({
            sessionId: s,
            requestId,
            withdrawnBy: "harness",
            reason: "The Harness withdrew the request",
          }),
        )
        // The Turn ending withdraws what is still pending, the same way.
        harness.emit({
          _tag: "ApprovalRequested",
          turnId,
          requestId: "req-2" as RequestId,
          kind: "command",
          title: "Again",
          detail: null,
          options: [],
        })
        yield* waitFor((m) => m.sessions.get(s)?.pending.size === 1)
        harness.emit({ _tag: "TurnEnded", turnId, status: "completed", error: null })
        const done = yield* waitFor((m) => m.sessions.get(s)?.session.state === "idle")
        const all = yield* store.readEvents({ after: 0, upTo: done.sequence, sessionId: s })
        expect(all.filter((e) => e.event._tag === "ApprovalWithdrawn")).toHaveLength(2)
        expect(done.sessions.get(s)!.pending.size).toBe(0)
      }),
    )
  })
})

describe("terminal hand-off", () => {
  test("Clients get the launch command; Polaris follows the TUI and resumes from its cursor", async () => {
    const claude = makeFakeDriver("claude", { follow: true, onTurn: completesTurns("c1") })
    const { layer } = setup({ drivers: [claude] })
    await run(
      layer,
      Effect.gen(function* () {
        const engine = yield* Engine
        const workspace = yield* registerWorkspace
        const s = sid("s-follow")
        yield* startSession(workspace, s)
        yield* waitFor((m) => m.sessions.get(s)?.session.state === "idle")
        expect(yield* engine.terminalCommand(s)).toBeNull()
        yield* dispatch({ _tag: "OpenInTerminal", sessionId: s })
        yield* waitUntil(() => claude.sessions[0]!.closed)
        const launch = yield* Effect.gen(function* () {
          while (true) {
            const found = yield* engine.terminalCommand(s)
            if (found !== null) return found
            yield* Effect.sleep(Duration.millis(5))
          }
        }).pipe(Effect.timeout(Duration.seconds(2)))
        expect(launch).toMatchObject({
          argv: ["claude", "--resume", "new"],
          cwd: workspace.path,
          env: {},
        })

        // The user works in the TUI: a finished Turn, a new native session, and a Turn
        // still open when they hand the session back.
        const t1 = "tui-1" as TurnId
        const t2 = "tui-2" as TurnId
        claude.follow.emit(
          s,
          { _tag: "TurnStarted", turnId: t1, prompt: "rename the helper" },
          {
            _tag: "ItemCompleted",
            turnId: t1,
            item: { _tag: "AssistantMessage", id: "a1", text: "Renamed." },
          },
          { _tag: "TurnEnded", turnId: t1, status: "completed", error: null },
          { _tag: "CursorAssigned", cursor: "c2" },
          { _tag: "TurnStarted", turnId: t2, prompt: "now the tests" },
        )
        const during = yield* waitFor(
          (m) => m.sessions.get(s)?.turns.some((t) => t.id === t2) === true,
        )
        expect(during.sessions.get(s)!.session.state).toBe("in-terminal")
        expect(during.sessions.get(s)!.turns.find((t) => t.id === t1)).toMatchObject({
          prompt: "rename the helper",
          status: "completed",
        })

        yield* dispatch({ _tag: "ReturnFromTerminal", sessionId: s })
        const back = yield* waitFor((m) => m.sessions.get(s)?.session.state === "idle")
        expect(claude.follow.released).toEqual([s])
        expect(yield* engine.terminalCommand(s)).toBeNull()
        const record = back.sessions.get(s)!
        expect(record.session.harnessCursor).toBe("c2")
        expect(record.turns.find((t) => t.id === t2)?.status).toBe("interrupted")
        // The Harness resumes the TUI's latest native session.
        expect(claude.sessions).toHaveLength(2)
        expect(claude.sessions[1]!.options.resumeCursor).toBe("c2")
      }),
    )
  })
})

describe("Fork", () => {
  test("a Fork gets its own Worktree at the checkpoint and a fresh Harness with context", async () => {
    const claude = makeFakeDriver("claude", { onTurn: completesTurns("parent-cursor") })
    const codex = makeFakeDriver("codex", { onTurn: completesTurns("fork-thread") })
    const { layer, fakes } = setup({ drivers: [claude, codex] })
    await run(
      layer,
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace
        const parent = sid("s-fork-parent")
        yield* startSession(workspace, parent)
        const model = yield* waitFor((m) => m.sessions.get(parent)?.session.state === "idle")
        const turn = model.sessions.get(parent)!.turns[0]!
        expect(turn.checkpointAfter).toBe(`refs/polaris/checkpoints/${parent}/${turn.id}/after`)

        const child = sid("s-fork-child")
        yield* dispatch({
          _tag: "ForkSession",
          sessionId: child,
          fromSessionId: parent,
          fromTurnId: turn.id,
          harness: "codex",
        })
        const branch = forkBranch(child)
        expect(branch).toMatch(/^polaris\/fork-[0-9a-f]{8}$/)
        const path = join(workspace.worktreeRoot, branch)
        const forked = yield* waitFor((m) => [...m.worktrees.values()].some((w) => w.path === path))
        expect(forked.sessions.get(child)!.session).toMatchObject({
          cwd: path,
          state: "dormant",
          harnessCursor: null,
          parentSessionId: parent,
          forkedFromTurnId: turn.id,
        })
        expect(fakes.worktreeCalls).toContainEqual({
          op: "create",
          path,
          detail: { branch, baseRef: turn.checkpointAfter },
        })
        const worktree = [...forked.worktrees.values()].find((w) => w.path === path)!
        expect(worktree).toMatchObject({ branch, createdBySessionId: child })

        yield* dispatch({
          _tag: "SendTurn",
          sessionId: child,
          prompt: "Try it with a retry instead",
          attachments: [],
        })
        const after = yield* waitFor((m) => m.sessions.get(child)?.session.state === "idle")
        const harness = codex.latest(child)!
        expect(harness.options).toMatchObject({ cwd: path, resumeCursor: null })
        const sent = harness.turns[0]!.prompt
        expect(sent).toStartWith("[Context from Polaris]")
        expect(sent).toContain("User: Fix the flaky test")
        expect(sent).toContain("Assistant: re: Fix the flaky test")
        expect(sent).toContain("new git worktree")
        expect(sent).toEndWith("Try it with a retry instead")
        // The Turn shows what the user typed; only the Harness got the context.
        expect(after.sessions.get(child)!.turns[0]!.prompt).toBe("Try it with a retry instead")

        // Later Turns resume the Fork's own cursor and get no preamble.
        yield* dispatch({ _tag: "SendTurn", sessionId: child, prompt: "and more", attachments: [] })
        yield* waitFor((m) => m.sessions.get(child)?.turns.length === 2)
        yield* waitUntil(() => harness.turns.length === 2)
        expect(harness.turns[1]!.prompt).toBe("and more")
      }),
    )
  })
})

describe("bounded buffers", () => {
  test("a stalled subscriber is dropped instead of growing memory, and resumes without gaps", async () => {
    const codex = makeFakeDriver("codex")
    const capacity = 16
    const { layer } = setup({ drivers: [codex], subscriberCapacity: capacity })
    await run(
      layer,
      Effect.gen(function* () {
        const engine = yield* Engine
        const store = yield* EventStore
        const workspace = yield* registerWorkspace
        const s = sid("s-stalled")
        yield* startSession(workspace, s, "codex")
        yield* waitFor((m) => m.sessions.get(s)?.session.state === "working")
        const harness = codex.latest(s)!
        const turnId = harness.turns[0]!.turnId
        const baseline = yield* store.subscriberCount

        // A Client that reads the snapshot, then stops reading.
        const gate = yield* Deferred.make<void>()
        const items: Array<SessionStreamItem> = []
        const fiber = yield* Stream.runForEach(
          engine.subscribeSession({ sessionId: s, afterSequence: null, turnLimit: null }),
          (item) =>
            Effect.gen(function* () {
              items.push(item)
              if (item._tag === "Synchronized") yield* Deferred.await(gate)
            }),
        ).pipe(Effect.forkChild)
        yield* waitUntil(() => items.some((i) => i._tag === "Synchronized"))
        expect(yield* store.subscriberCount).toBe(baseline + 1)

        // Deltas never cost it the subscription: they stop being buffered at half capacity.
        for (let i = 0; i < 10_000; i++)
          harness.emit({ _tag: "ItemDelta", turnId, itemId: "m1", field: "text", text: "x" })
        yield* Effect.sleep(Duration.millis(50))
        expect(yield* store.subscriberCount).toBe(baseline + 1)

        // Committed events past the capacity drop it rather than skipping any.
        for (let i = 0; i < capacity * 4; i++)
          harness.emit({
            _tag: "ItemCompleted",
            turnId,
            item: { _tag: "AssistantMessage", id: `m${i}`, text: `${i}` },
          })
        const deadline = Date.now() + 2000
        while ((yield* store.subscriberCount) > baseline && Date.now() < deadline)
          yield* Effect.sleep(Duration.millis(5))
        expect(yield* store.subscriberCount).toBe(baseline)

        // Released, it drains what was buffered (bounded), then its stream ends.
        yield* Deferred.succeed(gate, undefined)
        yield* Fiber.join(fiber)
        const drained = items.slice(items.findIndex((i) => i._tag === "Synchronized") + 1)
        expect(drained.length).toBeLessThanOrEqual(capacity)
        expect(drained.filter((i) => i._tag === "Delta").length).toBeLessThanOrEqual(capacity / 2)

        // Let every item commit, then resume from the last sequence it saw: the replay
        // fills in the rest, with no gaps.
        const items64 = Effect.map(
          store.readTurnItems({ turnIds: [turnId], upTo: Number.MAX_SAFE_INTEGER }),
          (byTurn) => byTurn.get(turnId)?.length ?? 0,
        )
        while ((yield* items64) < capacity * 4) yield* Effect.sleep(Duration.millis(5))
        const seen = items.flatMap((i) => (i._tag === "Event" ? [i.envelope.sequence] : []))
        const snapshot = items[0]!
        if (snapshot._tag !== "Snapshot") throw new Error("expected a snapshot")
        const last = (seen.at(-1) ?? snapshot.sequence) as Sequence
        const resumed: Array<SessionStreamItem> = []
        const again = yield* Stream.runForEach(
          engine.subscribeSession({ sessionId: s, afterSequence: last, turnLimit: null }),
          (item) => Effect.sync(() => void resumed.push(item)),
        ).pipe(Effect.forkChild)
        yield* waitUntil(() => resumed.some((i) => i._tag === "Synchronized"))
        const replayed = resumed.flatMap((i) =>
          i._tag === "Event" ? [i.envelope.sequence as number] : [],
        )
        const all = [...seen.map(Number), ...replayed]
        const model = yield* store.model
        const expected = (yield* store.readEvents({
          after: snapshot.sequence,
          upTo: model.sequence,
          sessionId: s,
        })).map((e) => e.sequence as number)
        expect(all).toEqual(expected)
        yield* Fiber.interrupt(again)
      }),
    )
  })
})

describe("recent Turns in memory", () => {
  test("the model keeps the last Turns; snapshots and Forks reach older ones in SQL", async () => {
    const claude = makeFakeDriver("claude")
    const codex = makeFakeDriver("codex")
    const { layer } = setup({ drivers: [claude, codex] })
    const total = RECENT_TURNS + 8
    await run(
      layer,
      Effect.gen(function* () {
        const engine = yield* Engine
        const store = yield* EventStore
        const workspace = yield* registerWorkspace
        const s = sid("s-long")
        const at = new Date().toISOString()
        const turnAt = (index: number) =>
          new Turn({
            id: `turn-${index}` as TurnId,
            sessionId: s,
            index,
            prompt: `prompt ${index}`,
            attachments: [],
            status: "completed",
            checkpointBefore: null,
            checkpointAfter: null,
            startedAt: at,
            endedAt: at,
          })
        yield* store.commit({
          commandId: null,
          decide: () =>
            Effect.succeed([
              DomainEvent.cases.SessionCreated.make({
                session: new AgentSession({
                  id: s,
                  workspaceId: workspace.id,
                  harness: "claude",
                  title: "Long",
                  cwd: workspace.path,
                  worktreeId: null,
                  state: "dormant",
                  permissionMode: "supervised",
                  model: null,
                  parentSessionId: null,
                  forkedFromTurnId: null,
                  harnessCursor: "cur",
                  turnCount: 0,
                  lastError: null,
                  createdAt: at,
                  updatedAt: at,
                }),
              }),
              ...Array.from({ length: total }, (_, i) =>
                DomainEvent.cases.TurnEnded.make({ turn: turnAt(i) }),
              ),
            ]),
        })
        const record = (yield* store.model).sessions.get(s)!
        expect(record.turns).toHaveLength(RECENT_TURNS)
        expect(record.turns[0]!.index).toBe(total - RECENT_TURNS)
        expect(record.session.turnCount).toBe(total)

        const snapshotOf = (turnLimit: number | null) =>
          engine
            .subscribeSession({ sessionId: s, afterSequence: null, turnLimit })
            .pipe(Stream.take(1), Stream.runCollect)
        const [full] = yield* snapshotOf(null)
        if (full?._tag !== "Snapshot") throw new Error("expected a snapshot")
        expect(full.turns.map((t) => t.turn.index)).toEqual(
          Array.from({ length: total }, (_, i) => i),
        )
        const [limited] = yield* snapshotOf(RECENT_TURNS + 3)
        if (limited?._tag !== "Snapshot") throw new Error("expected a snapshot")
        expect(limited.turns.map((t) => t.turn.index)[0]).toBe(total - RECENT_TURNS - 3)

        // A new Turn gets the next index, not the in-memory count.
        yield* dispatch({ _tag: "SendTurn", sessionId: s, prompt: "next", attachments: [] })
        const next = yield* waitFor((m) => m.sessions.get(s)?.session.turnCount === total + 1)
        expect(next.sessions.get(s)!.turns.at(-1)).toMatchObject({ index: total, prompt: "next" })
        expect(next.sessions.get(s)!.turns).toHaveLength(RECENT_TURNS)

        // Forking from a Turn no longer in memory still works.
        yield* dispatch({
          _tag: "ForkSession",
          sessionId: sid("s-long-fork"),
          fromSessionId: s,
          fromTurnId: "turn-0" as TurnId,
          harness: "codex",
        })
        const forked = yield* waitFor((m) => m.sessions.has(sid("s-long-fork")))
        expect(forked.sessions.get(sid("s-long-fork"))!.session.forkedFromTurnId).toBe(
          "turn-0" as TurnId,
        )
      }),
    )
  })
})

describe("upgrade", () => {
  test("prepareForUpgrade closes in-process Harnesses per the recovery rule", async () => {
    const claude = makeFakeDriver("claude")
    const codex = makeFakeDriver("codex", { liveCoAttach: true })
    const { layer } = setup({ drivers: [claude, codex] })
    await run(
      layer,
      Effect.gen(function* () {
        const engine = yield* Engine
        const workspace = yield* registerWorkspace
        const busy = sid("s-up-busy")
        const idle = sid("s-up-idle")
        const remote = sid("s-up-codex")
        yield* startSession(workspace, busy)
        yield* startSession(workspace, idle)
        yield* startSession(workspace, remote, "codex")
        yield* waitFor(
          (m) =>
            m.sessions.get(busy)?.session.state === "working" &&
            m.sessions.get(idle)?.session.state === "working" &&
            m.sessions.get(remote)?.session.state === "working",
        )
        const idleHarness = claude.latest(idle)!
        const idleTurn = idleHarness.turns[0]!.turnId
        idleHarness.emit(
          { _tag: "CursorAssigned", cursor: "idle-cursor" },
          { _tag: "TurnEnded", turnId: idleTurn, status: "completed", error: null },
        )
        const busyHarness = claude.latest(busy)!
        busyHarness.emit(
          { _tag: "CursorAssigned", cursor: "busy-cursor" },
          {
            _tag: "ApprovalRequested",
            turnId: busyHarness.turns[0]!.turnId,
            requestId: "req-up" as RequestId,
            kind: "command",
            title: "Run",
            detail: null,
            options: [],
          },
        )
        yield* waitFor(
          (m) =>
            m.sessions.get(idle)?.session.state === "idle" &&
            m.sessions.get(busy)?.session.state === "needs-you",
        )

        yield* engine.prepareForUpgrade
        const model = yield* EventStore.pipe(Effect.flatMap((store) => store.model))
        const b = model.sessions.get(busy)!
        expect(b.session.state).toBe("needs-you")
        expect(b.turns[0]!.status).toBe("interrupted")
        expect(b.pending.size).toBe(0)
        expect(model.sessions.get(idle)!.session.state).toBe("dormant")
        expect(busyHarness.closed).toBe(true)
        expect(idleHarness.closed).toBe(true)
        // Codex lives in the shared app-server, which outlives the Daemon.
        expect(model.sessions.get(remote)!.session.state).toBe("working")
        expect(codex.latest(remote)!.closed).toBe(false)

        // They resume afterwards: Continue for the interrupted Turn, a new Turn for the other.
        yield* dispatch({ _tag: "Continue", sessionId: busy })
        yield* waitUntil(
          () => claude.sessions.filter((x) => x.options.sessionId === busy).length === 2,
        )
        expect(claude.latest(busy)!.options.resumeCursor).toBe("busy-cursor")
        yield* dispatch({ _tag: "SendTurn", sessionId: idle, prompt: "go on", attachments: [] })
        yield* waitUntil(
          () => claude.sessions.filter((x) => x.options.sessionId === idle).length === 2,
        )
        expect(claude.latest(idle)!.options.resumeCursor).toBe("idle-cursor")
      }),
    )
  })
})
