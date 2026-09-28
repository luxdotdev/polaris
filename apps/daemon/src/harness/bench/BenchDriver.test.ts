import { describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { RequestId, SessionId, TurnId } from "@polaris/protocol"
import { Effect, Fiber, Stream } from "effect"
import type { HarnessEvent } from "../HarnessDriver.ts"
import { BENCH_PROMPT_PREFIX, DEFAULT_SCRIPT, makeBenchDriver, parseScript } from "./BenchDriver.ts"

describe("parseScript", () => {
  test("reads a bench: prompt over the defaults, and falls back on anything else", () => {
    expect(parseScript(`${BENCH_PROMPT_PREFIX}{"items":3}`)).toEqual({
      ...DEFAULT_SCRIPT,
      items: 3,
    })
    expect(parseScript("Fix the flaky test")).toEqual(DEFAULT_SCRIPT)
    expect(parseScript(`${BENCH_PROMPT_PREFIX}{not json`)).toEqual(DEFAULT_SCRIPT)
  })
})

describe("bench Harness", () => {
  test("streams a scripted Turn, waits on its approval, and touches files", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "polaris-bench-driver-"))
    const events = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const driver = makeBenchDriver("codex")
          const session = yield* driver.open({
            sessionId: "s1" as SessionId,
            cwd,
            permissionMode: "supervised",
            model: null,
            resumeCursor: null,
          })
          const seen: Array<HarnessEvent> = []
          const consumer = yield* session.events.pipe(
            Stream.tap((event) =>
              Effect.gen(function* () {
                seen.push(event)
                if (event._tag === "ApprovalRequested") {
                  yield* session.respond(event.requestId, { _tag: "Allow", remember: false })
                }
              }),
            ),
            Stream.takeUntil((event) => event._tag === "TurnEnded"),
            Stream.runDrain,
            Effect.forkScoped,
          )
          yield* session.sendTurn({
            turnId: "t1" as TurnId,
            prompt: `${BENCH_PROMPT_PREFIX}${JSON.stringify({
              items: 5,
              deltasPerItem: 3,
              deltaBytes: 32,
              deltaIntervalMs: 0,
              approvalEvery: 2,
              touchFiles: 2,
            })}`,
            attachments: [],
          })
          yield* Fiber.join(consumer)
          return seen
        }),
      ),
    )
    const tags = events.map((e) => e._tag)
    expect(tags[0]).toBe("CursorAssigned")
    expect(tags[1]).toBe("TurnStarted")
    expect(tags.at(-1)).toBe("TurnEnded")
    expect(tags.filter((t) => t === "ItemCompleted")).toHaveLength(5)
    // Items 0–2 of every five stream deltas: 3 items × 3 deltas.
    const deltas = events.filter((e) => e._tag === "ItemDelta")
    expect(deltas).toHaveLength(9)
    for (const d of deltas) {
      expect(d.text).toHaveLength(32)
      expect(d.text).toMatch(/^@\d+\.\d+\|x+$/)
    }
    expect(
      events.filter((e) => e._tag === "ApprovalRequested").map((e) => e.requestId as RequestId),
    ).toHaveLength(2)
    expect(readdirSync(join(cwd, "polaris-bench"))).toHaveLength(2)
  })

  test("interrupt ends the Turn in flight as interrupted", async () => {
    const end = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* makeBenchDriver("claude").open({
            sessionId: "s2" as SessionId,
            cwd: tmpdir(),
            permissionMode: "supervised",
            model: null,
            resumeCursor: "cursor",
          })
          yield* session.sendTurn({
            turnId: "t1" as TurnId,
            prompt: `${BENCH_PROMPT_PREFIX}{"items":100,"deltaIntervalMs":50}`,
            attachments: [],
          })
          const ended = yield* session.events.pipe(
            Stream.tap((event) => (event._tag === "TurnStarted" ? session.interrupt : Effect.void)),
            Stream.filter((event) => event._tag === "TurnEnded"),
            Stream.runHead,
          )
          return ended
        }),
      ),
    )
    expect(end._tag === "Some" && end.value._tag === "TurnEnded" && end.value.status).toBe(
      "interrupted",
    )
  })
})
