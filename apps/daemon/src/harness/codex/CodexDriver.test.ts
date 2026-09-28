import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { type PermissionMode, RequestId, SessionId, TurnId } from "@polaris/protocol"
import { Effect, Stream } from "effect"
import type { HarnessEvent, HarnessSession } from "../HarnessDriver.ts"
import { makeCodexDriver, probeCodex } from "./CodexDriver.ts"
import {
  type ClientRequest,
  type FakeAppServer,
  type FakeConnection,
  type Handler,
  readFixture,
  replay,
  startFakeAppServer,
} from "./testing/FakeAppServer.ts"

const THREAD = "thr_1"
const cleanup: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn()
})

/** Socket paths must stay under ~104 bytes, so tests use /tmp directly. */
const socketPath = () => {
  const dir = mkdtempSync("/tmp/pcx-")
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  return join(dir, "s.sock")
}

interface Harness {
  readonly session: HarnessSession
  readonly server: FakeAppServer
  readonly events: Array<HarnessEvent>
  readonly waitFor: (
    predicate: (e: HarnessEvent) => boolean,
    label?: string,
  ) => Effect.Effect<HarnessEvent>
}

/** Opens a session against a fake app-server and runs `body`; the scope closes afterwards. */
const withSession = <A>(
  handler: Handler,
  body: (h: Harness) => Effect.Effect<A, unknown>,
  options: { readonly resumeCursor?: string; readonly permissionMode?: PermissionMode } = {},
): Promise<{ result: A; events: Array<HarnessEvent>; server: FakeAppServer }> => {
  const path = socketPath()
  const server = startFakeAppServer(path, handler)
  cleanup.push(server.stop)
  const events: Array<HarnessEvent> = []
  const program = Effect.gen(function* () {
    const driver = yield* makeCodexDriver({
      socketPath: path,
      spawnAppServer: false,
      codexPath: "/opt/codex/bin/codex",
    })
    const session = yield* driver.open({
      sessionId: SessionId.make("s1"),
      cwd: "/repo",
      permissionMode: options.permissionMode ?? "supervised",
      model: null,
      resumeCursor: options.resumeCursor ?? null,
    })
    yield* session.events.pipe(
      Stream.runForEach((e) => Effect.sync(() => events.push(e))),
      // Detached, so it keeps reading through scope close and sees the final `Exited`.
      Effect.forkDetach,
    )
    const waitFor = (predicate: (e: HarnessEvent) => boolean, label = "event") =>
      Effect.promise(async () => {
        for (let i = 0; i < 200; i++) {
          const found = events.find(predicate)
          if (found) return found
          await Bun.sleep(10)
        }
        throw new Error(`timed out waiting for ${label}; saw ${events.map((e) => e._tag)}`)
      })
    return yield* body({ session, server, events, waitFor })
  })
  return Effect.runPromise(Effect.scoped(program)).then(async (result) => {
    await Bun.sleep(20)
    return { result, events, server }
  })
}

/** A handler for the handshake and thread lifecycle, delegating the rest. */
const scripted =
  (rest: (request: ClientRequest, conn: FakeConnection) => void | Promise<void>): Handler =>
  (request, conn) => {
    switch (request.method) {
      case "initialize":
        return conn.reply({ userAgent: "fake", codexHome: "/home/user/.codex" })
      case "thread/start":
        return conn.reply({ thread: { id: THREAD } })
      case "thread/resume":
        return conn.reply({ thread: { id: (request.params as { threadId: string }).threadId } })
      case "thread/unsubscribe":
        return conn.reply({ status: "unsubscribed" })
      default:
        return rest(request, conn)
    }
  }

const turn = (id: string, status = "inProgress", error: unknown = null) => ({
  id,
  items: [],
  itemsView: "notLoaded",
  status,
  error,
  startedAt: null,
  completedAt: null,
  durationMs: null,
})

describe("Codex driver against a fake app-server", () => {
  test("replays a recorded full Turn", async () => {
    const frames = await readFixture(join(import.meta.dir, "fixtures/full-turn.jsonl"))
    const { events, server } = await withSession(replay(frames), ({ session, waitFor }) =>
      Effect.gen(function* () {
        yield* session.sendTurn({
          turnId: TurnId.make("turn-1"),
          prompt: "say ok",
          attachments: [],
        })
        yield* waitFor((e) => e._tag === "TurnEnded", "TurnEnded")
      }),
    )
    const threadId = "01a0e68a-7f27-7583-8ddc-d1194aeb14f4"
    expect(events.map((e) => e._tag)).toEqual([
      "CursorAssigned",
      "TurnStarted",
      "ItemDelta",
      "ItemCompleted",
      "TurnEnded",
      "Exited",
    ])
    expect(events[0]).toEqual({ _tag: "CursorAssigned", cursor: threadId })
    expect(events[1]).toEqual({ _tag: "TurnStarted", turnId: TurnId.make("turn-1") })
    expect(events[2]).toMatchObject({ _tag: "ItemDelta", field: "text", text: "ok" })
    expect(events[3]).toMatchObject({
      _tag: "ItemCompleted",
      turnId: "turn-1",
      item: { _tag: "AssistantMessage", text: "ok" },
    })
    expect(events[4]).toEqual({
      _tag: "TurnEnded",
      turnId: TurnId.make("turn-1"),
      status: "completed",
      error: null,
    })
    expect(events[5]).toEqual({ _tag: "Exited", error: null })
    expect(server.received.map((m) => m.method)).toEqual([
      "initialize",
      "initialized",
      "thread/start",
      "turn/start",
      "thread/unsubscribe",
    ])
    expect(server.requests("thread/start")[0]?.params).toMatchObject({
      cwd: "/repo",
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
      sandbox: "read-only",
    })
  })

  test("an approval round-trip answers the server request", async () => {
    let approval: Promise<unknown> = Promise.resolve()
    const handler = scripted((request, conn) => {
      if (request.method !== "turn/start") return
      conn.reply({ turn: turn("t1") })
      conn.notify("turn/started", { threadId: THREAD, turn: turn("t1") })
      approval = conn
        .request("item/commandExecution/requestApproval", {
          threadId: THREAD,
          turnId: "t1",
          itemId: "cmd1",
          startedAtMs: 0,
          kind: "command",
          environmentId: null,
          command: "bun test",
          cwd: "/repo",
          reason: "run the tests",
        })
        .then((answer) => {
          conn.notify("serverRequest/resolved", { threadId: THREAD, requestId: 1000 })
          conn.notify("item/completed", {
            threadId: THREAD,
            turnId: "t1",
            completedAtMs: 0,
            item: {
              type: "commandExecution",
              id: "cmd1",
              command: "bun test",
              cwd: "/repo",
              status: "completed",
              aggregatedOutput: "1 pass",
              exitCode: 0,
              commandActions: [],
              durationMs: 5,
            },
          })
          conn.notify("turn/completed", { threadId: THREAD, turn: turn("t1", "completed") })
          return answer
        })
    })
    const { events } = await withSession(handler, ({ session, waitFor }) =>
      Effect.gen(function* () {
        yield* session.sendTurn({ turnId: TurnId.make("turn-1"), prompt: "test", attachments: [] })
        const asked = yield* waitFor((e) => e._tag === "ApprovalRequested", "approval")
        expect(asked).toMatchObject({
          turnId: "turn-1",
          kind: "command",
          title: "bun test",
          detail: "run the tests",
        })
        if (asked._tag !== "ApprovalRequested") throw new Error("unreachable")
        yield* session.respond(asked.requestId, { _tag: "Allow", remember: true })
        yield* waitFor((e) => e._tag === "TurnEnded", "TurnEnded")
        expect(yield* Effect.promise(() => approval)).toEqual({ decision: "acceptForSession" })
        // A second answer to the same request is rejected rather than sent twice.
        const again = yield* Effect.flip(
          session.respond(asked.requestId, { _tag: "Allow", remember: false }),
        )
        expect(again.message).toContain("No open Codex request")
      }),
    )
    // Our own answer's `serverRequest/resolved` is not reported as a withdrawal.
    expect(events.some((e) => e._tag === "ApprovalWithdrawn")).toBe(false)
    expect(events.find((e) => e._tag === "ItemCompleted")).toMatchObject({
      item: {
        _tag: "CommandExecution",
        command: "bun test",
        output: "1 pass",
        exitCode: 0,
        status: "completed",
      },
    })
  })

  test("interrupt stops the Turn and withdraws its open approval", async () => {
    const handler = scripted((request, conn) => {
      switch (request.method) {
        case "turn/start":
          conn.reply({ turn: turn("t1") })
          conn.notify("turn/started", { threadId: THREAD, turn: turn("t1") })
          void conn.request("item/fileChange/requestApproval", {
            threadId: THREAD,
            turnId: "t1",
            itemId: "fc1",
            startedAtMs: 0,
            reason: null,
          })
          return
        case "turn/interrupt":
          conn.reply({})
          conn.notify("serverRequest/resolved", { threadId: THREAD, requestId: 1000 })
          conn.notify("turn/completed", { threadId: THREAD, turn: turn("t1", "interrupted") })
          return
      }
    })
    const { events, server } = await withSession(handler, ({ session, waitFor }) =>
      Effect.gen(function* () {
        yield* session.sendTurn({ turnId: TurnId.make("turn-1"), prompt: "edit", attachments: [] })
        const asked = yield* waitFor((e) => e._tag === "ApprovalRequested", "approval")
        expect(asked).toMatchObject({ kind: "file-change", title: "Apply file changes" })
        yield* session.interrupt
        yield* waitFor((e) => e._tag === "TurnEnded", "TurnEnded")
        if (asked._tag !== "ApprovalRequested") throw new Error("unreachable")
        return asked.requestId
      }),
    )
    expect(server.requests("turn/interrupt")[0]?.params).toEqual({ threadId: THREAD, turnId: "t1" })
    const tags = events.map((e) => e._tag)
    expect(tags.indexOf("ApprovalWithdrawn")).toBeLessThan(tags.indexOf("TurnEnded"))
    expect(events.find((e) => e._tag === "TurnEnded")).toMatchObject({ status: "interrupted" })
  })

  test("resume rejoins the thread and follows a Turn started elsewhere", async () => {
    const handler = scripted((request, conn) => {
      if (request.method === "turn/steer") {
        conn.reply({ turnId: "t_tui" })
        conn.notify("turn/completed", { threadId: THREAD, turn: turn("t_tui", "completed") })
      }
    })
    let sendThreadNotifications: (() => void) | null = null
    const wrapped: Handler = (request, conn) => {
      if (request.method === "thread/resume")
        sendThreadNotifications = () => {
          // A Turn the co-attached TUI started: no turn/start from Polaris, and we rejoin mid-way.
          conn.notify("item/agentMessage/delta", {
            threadId: THREAD,
            turnId: "t_tui",
            itemId: "m1",
            delta: "Working",
          })
          conn.notify("thread/name/updated", { threadId: THREAD, threadName: "Fix the tests" })
          // Another thread on the shared server is ignored.
          conn.notify("turn/started", { threadId: "thr_other", turn: turn("t_other") })
        }
      return handler(request, conn)
    }
    const { events, server } = await withSession(
      wrapped,
      ({ session, waitFor }) =>
        Effect.gen(function* () {
          sendThreadNotifications?.()
          const delta = yield* waitFor((e) => e._tag === "ItemDelta", "delta")
          const started = yield* waitFor((e) => e._tag === "TurnStarted", "TurnStarted")
          expect(delta).toMatchObject({ itemId: "m1", text: "Working" })
          if (started._tag !== "TurnStarted" || delta._tag !== "ItemDelta")
            throw new Error("unreachable")
          expect(delta.turnId).toBe(started.turnId)
          yield* waitFor((e) => e._tag === "TitleSuggested", "title")
          // Sending a Turn while one is in flight is refused; steering is the way in.
          const busy = yield* Effect.flip(
            session.sendTurn({ turnId: TurnId.make("x"), prompt: "no", attachments: [] }),
          )
          expect(busy.message).toContain("already in progress")
          yield* session.steer("also run lint")
          yield* waitFor((e) => e._tag === "TurnEnded", "TurnEnded")
          expect(yield* session.terminalCommand).toEqual([
            "/opt/codex/bin/codex",
            "resume",
            THREAD,
            "--remote",
            expect.stringMatching(/^unix:\/\/\/tmp\/pcx-.*\/s\.sock$/),
          ])
        }),
      { resumeCursor: THREAD, permissionMode: "auto" },
    )
    expect(server.requests("thread/resume")[0]?.params).toMatchObject({
      threadId: THREAD,
      excludeTurns: true,
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandbox: "workspace-write",
    })
    expect(server.requests("thread/start")).toEqual([])
    expect(server.requests("turn/steer")[0]?.params).toMatchObject({
      threadId: THREAD,
      expectedTurnId: "t_tui",
      input: [{ type: "text", text: "also run lint" }],
    })
    expect(events[0]).toEqual({ _tag: "CursorAssigned", cursor: THREAD })
    expect(events.filter((e) => e._tag === "TurnStarted")).toHaveLength(1)
    expect(events.find((e) => e._tag === "TitleSuggested")).toEqual({
      _tag: "TitleSuggested",
      title: "Fix the tests",
    })
  })

  test("an async question is answered with a new user message", async () => {
    const handler = scripted((request, conn) => {
      if (request.method !== "turn/start") return
      const text = (request.params as { input: Array<{ text?: string }> }).input[0]?.text
      const id = text === "say hi" ? "t1" : "t2"
      conn.reply({ turn: turn(id) })
      conn.notify("turn/started", { threadId: THREAD, turn: turn(id) })
      if (id === "t1")
        conn.notify("item/completed", {
          threadId: THREAD,
          turnId: "t1",
          completedAtMs: 0,
          item: {
            type: "agentMessage",
            id: "m1",
            text: "Which database?",
            phase: null,
            memoryCitation: null,
            delivery: "async",
            questions: [{ title: "Which database?", options: ["Postgres", "SQLite"] }],
          },
        })
      conn.notify("turn/completed", { threadId: THREAD, turn: turn(id, "completed") })
    })
    const { events, server } = await withSession(handler, ({ session, waitFor }) =>
      Effect.gen(function* () {
        yield* session.sendTurn({
          turnId: TurnId.make("turn-1"),
          prompt: "say hi",
          attachments: [],
        })
        const asked = yield* waitFor((e) => e._tag === "ApprovalRequested", "question")
        expect(asked).toMatchObject({
          kind: "question",
          title: "Which database?",
          options: ["Postgres", "SQLite"],
        })
        yield* waitFor((e) => e._tag === "TurnEnded", "TurnEnded")
        if (asked._tag !== "ApprovalRequested") throw new Error("unreachable")
        yield* session.respond(asked.requestId, { _tag: "Answer", text: "SQLite" })
        yield* waitFor(
          (e) => e._tag === "TurnEnded" && e.turnId !== TurnId.make("turn-1"),
          "second TurnEnded",
        )
      }),
    )
    expect(server.requests("turn/start")[1]?.params).toMatchObject({
      threadId: THREAD,
      input: [{ type: "text", text: "SQLite" }],
    })
    expect(events.filter((e) => e._tag === "TurnStarted")).toHaveLength(2)
  })

  test("refuses credential and unsupported server requests, and reports a dropped server", async () => {
    let refusal: Promise<unknown> = Promise.resolve()
    let drop = () => {}
    const handler = scripted((request, conn) => {
      if (request.method !== "turn/start") return
      conn.reply({ turn: turn("t1") })
      refusal = conn.request("account/chatgptAuthTokens/refresh", { reason: "unauthorized" })
      drop = conn.drop
    })
    const { events } = await withSession(handler, ({ session, waitFor }) =>
      Effect.gen(function* () {
        yield* session.sendTurn({ turnId: TurnId.make("turn-1"), prompt: "go", attachments: [] })
        expect(yield* Effect.promise(() => refusal)).toMatchObject({ error: { code: -32601 } })
        drop()
        yield* waitFor((e) => e._tag === "Exited", "Exited")
        const failed = yield* Effect.flip(session.steer("anything"))
        expect(failed._tag).toBe("HarnessError")
      }),
    )
    const exited = events.filter((e) => e._tag === "Exited")
    expect(exited).toHaveLength(1)
    expect(exited[0]).toMatchObject({ error: expect.stringContaining("closed the connection") })
  })

  test("responding to an unknown request fails", async () => {
    await withSession(
      scripted(() => {}),
      ({ session }) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            session.respond(RequestId.make("nope"), { _tag: "Deny", reason: null }),
          )
          expect(error.harness).toBe("codex")
        }),
    )
  })
})

describe("probe", () => {
  test("only runs `codex --version`", async () => {
    const dir = mkdtempSync("/tmp/pcx-")
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    const fake = join(dir, "codex")
    const log = join(dir, "argv")
    writeFileSync(fake, `#!/bin/sh\necho "$@" >> "${log}"\necho "codex-cli 9.8.7"\n`)
    chmodSync(fake, 0o755)
    const probe = await Effect.runPromise(probeCodex(fake))
    expect(probe).toEqual({ available: true, version: "9.8.7", detail: fake })
    expect((await Bun.file(log).text()).trim()).toBe("--version")
  })

  test("reports a missing codex", async () => {
    expect(await Effect.runPromise(probeCodex(null))).toMatchObject({ available: false })
    expect(await Effect.runPromise(probeCodex("/nonexistent/codex"))).toMatchObject({
      available: false,
    })
  })
})
