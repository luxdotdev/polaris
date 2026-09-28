import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { RequestId, SessionId, TurnId } from "@polaris/protocol"
import { Effect, Exit, Scope, Stream } from "effect"
import type { HarnessEvent } from "../HarnessDriver.ts"
import { makeClaudeDriver } from "./ClaudeDriver.ts"
import { FakeClaude, init } from "./fakeClaude.ts"
import { ClaudeHookReceiver, FOLLOWED_HOOK_EVENTS, HookTranslator, hookSettings } from "./hooks.ts"

const base = { session_id: "cs-1", transcript_path: "/t.jsonl", cwd: "/work/repo" }

const sequence = () => {
  let n = 0
  return {
    newTurnId: () => `t${++n}` as TurnId,
    newRequestId: () => `r${++n}` as RequestId,
  }
}

describe("hookSettings", () => {
  test("subscribes every followed event over http with the bearer token and a short timeout", () => {
    const settings = hookSettings({ url: "http://127.0.0.1:9/hooks/s", token: "tok" })
    expect(Object.keys(settings.hooks)).toEqual([...FOLLOWED_HOOK_EVENTS])
    expect(settings.hooks.PreToolUse).toEqual([
      {
        matcher: "*",
        hooks: [
          {
            type: "http",
            url: "http://127.0.0.1:9/hooks/s",
            headers: { Authorization: "Bearer tok" },
            timeout: 5,
          },
        ],
      },
    ])
    expect(settings.hooks.Stop?.[0]).not.toHaveProperty("matcher")
  })
})

describe("HookTranslator", () => {
  test("a Turn typed in the TUI, with a tool, a permission prompt, and a stop", () => {
    const h = new HookTranslator({ cursor: "cs-1", ...sequence() })
    const events: unknown[] = [
      { ...base, hook_event_name: "UserPromptSubmit", prompt: "run tests" },
      {
        ...base,
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_use_id: "tu1",
        tool_input: { command: "bun test" },
      },
      {
        ...base,
        hook_event_name: "Notification",
        notification_type: "permission_prompt",
        message: "Claude needs your permission to use Bash",
      },
      {
        ...base,
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_use_id: "tu1",
        tool_input: { command: "bun test" },
        tool_response: { stdout: "17 pass", stderr: "", interrupted: false },
      },
      {
        ...base,
        hook_event_name: "Stop",
        stop_hook_active: false,
        last_assistant_message: "Green.",
      },
    ].flatMap((b) => h.onHook(b))

    expect(events).toEqual([
      { _tag: "TurnStarted", turnId: "t1" },
      {
        _tag: "ItemCompleted",
        turnId: "t1",
        item: {
          _tag: "CommandExecution",
          id: "tu1",
          command: "bun test",
          cwd: "/work/repo",
          output: "",
          exitCode: null,
          status: "running",
        },
      },
      {
        _tag: "ApprovalRequested",
        turnId: "t1",
        requestId: "r2",
        kind: "command",
        title: "Claude needs your permission to use Bash",
        detail: "bun test",
        options: [],
      },
      { _tag: "ApprovalWithdrawn", requestId: "r2" },
      {
        _tag: "ItemCompleted",
        turnId: "t1",
        item: {
          _tag: "CommandExecution",
          id: "tu1",
          command: "bun test",
          cwd: "/work/repo",
          output: "17 pass",
          exitCode: null,
          status: "completed",
        },
      },
      {
        _tag: "ItemCompleted",
        turnId: "t1",
        item: { _tag: "AssistantMessage", id: "stop:t1", text: "Green." },
      },
      { _tag: "TurnEnded", turnId: "t1", status: "completed", error: null },
    ])
  })

  test("a new cursor, failures, plans, subagents and session end", () => {
    const h = new HookTranslator({ cursor: null, ...sequence() })
    const events: unknown[] = [
      {
        ...base,
        hook_event_name: "PostToolUseFailure",
        tool_name: "Edit",
        tool_use_id: "tu1",
        tool_input: { file_path: "/work/repo/a.ts" },
        error: "no match",
      },
      {
        ...base,
        agent_id: "sub-1",
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_use_id: "tu2",
        tool_input: {},
      },
      {
        ...base,
        hook_event_name: "PostToolUse",
        tool_name: "TodoWrite",
        tool_use_id: "tu3",
        tool_input: { todos: [{ content: "a", status: "in_progress", activeForm: "a" }] },
        tool_response: {},
      },
      { ...base, hook_event_name: "SessionEnd", reason: "prompt_input_exit" },
      { ...base, hook_event_name: "Stop" },
    ].flatMap((b) => h.onHook(b))

    expect(events).toEqual([
      { _tag: "CursorAssigned", cursor: "cs-1" },
      { _tag: "TurnStarted", turnId: "t1" },
      {
        _tag: "ItemCompleted",
        turnId: "t1",
        item: {
          _tag: "FileChange",
          id: "tu1",
          changes: [{ path: "/work/repo/a.ts", kind: "modify" }],
          status: "failed",
        },
      },
      {
        _tag: "ItemCompleted",
        turnId: "t1",
        item: { _tag: "Plan", id: "plan:t1", steps: [{ text: "a", status: "in-progress" }] },
      },
      { _tag: "TurnEnded", turnId: "t1", status: "interrupted", error: null },
      { _tag: "Exited", error: null },
    ])
    expect(h.isEnded).toBe(true)
  })

  test("ignores malformed bodies and notifications that aren't permission prompts", () => {
    const h = new HookTranslator({ cursor: "cs-1" })
    expect(h.onHook("nope")).toEqual([])
    expect(
      h.onHook({ ...base, hook_event_name: "Notification", notification_type: "idle_prompt" }),
    ).toEqual([])
  })
})

describe("ClaudeHookReceiver", () => {
  const withReceiver = async (
    body: (receiver: ClaudeHookReceiver["Service"], settingsDir: string) => Promise<void>,
  ) => {
    const settingsDir = join(await mkdtemp(join(tmpdir(), "polaris-hooks-")), "hooks")
    const scope = Effect.runSync(Scope.make())
    const receiver = await Effect.runPromise(
      ClaudeHookReceiver.make({ settingsDir }).pipe(Scope.provide(scope)),
    )
    try {
      await body(receiver, settingsDir)
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  }

  test("writes a private settings file and follows a session over loopback", async () => {
    await withReceiver(async (receiver) => {
      const sessionId = "session-1" as SessionId
      const { settingsPath } = await Effect.runPromise(
        receiver.prepare({ sessionId, cursor: "cs-1" }),
      )
      expect((await stat(settingsPath)).mode & 0o777).toBe(0o600)
      const settings = JSON.parse(await readFile(settingsPath, "utf8"))
      const hook = settings.hooks.Stop[0].hooks[0]
      expect(hook.url).toBe(`http://127.0.0.1:${receiver.port}/hooks/session-1`)

      const post = (headers: Record<string, string>, body: unknown) =>
        fetch(hook.url, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        })

      expect((await post({}, { ...base, hook_event_name: "Stop" })).status).toBe(401)
      expect(
        (await post({ Authorization: "Bearer wrong" }, { ...base, hook_event_name: "Stop" }))
          .status,
      ).toBe(401)

      const auth = hook.headers as Record<string, string>
      const ok = await post(auth, { ...base, hook_event_name: "UserPromptSubmit", prompt: "hi" })
      expect(ok.status).toBe(200)
      expect(await ok.json()).toEqual({})
      await post(auth, { ...base, hook_event_name: "Stop", last_assistant_message: "hello" })
      await post(auth, { ...base, hook_event_name: "SessionEnd", reason: "other" })

      const events: HarnessEvent[] = await Effect.runPromise(
        Stream.runCollect(receiver.events(sessionId)),
      )
      expect(events.map((e) => e._tag)).toEqual([
        "TurnStarted",
        "ItemCompleted",
        "TurnEnded",
        "Exited",
      ])

      await Effect.runPromise(receiver.release(sessionId))
      await expect(stat(settingsPath)).rejects.toThrow()
    })
  })

  test("the driver's terminal command carries the settings file", async () => {
    await withReceiver(async (receiver) => {
      const fake = new FakeClaude()
      const driver = makeClaudeDriver({
        query: fake.query,
        claudePath: () => "/opt/bin/claude",
        hookReceiver: receiver,
      })
      const scope = Effect.runSync(Scope.make())
      const session = await Effect.runPromise(
        driver
          .open({
            sessionId: "session-2" as SessionId,
            cwd: "/work/repo",
            permissionMode: "supervised",
            model: null,
            resumeCursor: null,
          })
          .pipe(Scope.provide(scope)),
      )
      fake.emit(init("cs-2"))
      let argv: ReadonlyArray<string> = []
      for (let i = 0; i < 100 && argv.length === 0; i++) {
        await Bun.sleep(2)
        const exit = await Effect.runPromiseExit(session.terminalCommand)
        if (Exit.isSuccess(exit)) argv = exit.value
      }
      expect(argv.slice(0, 4)).toEqual(["claude", "--resume", "cs-2", "--settings"])
      expect(argv[4]).toEndWith("/hooks/session-2.json")
      await Effect.runPromise(Scope.close(scope, Exit.void))
    })
  })
})
