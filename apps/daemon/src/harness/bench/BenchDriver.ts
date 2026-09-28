/**
 * A scripted Harness for benchmarks (`packages/bench`). It spends no tokens and
 * runs no vendor process, but emits realistic Turns through the real engine,
 * store, streams and transport: streamed deltas at a set rate, command output,
 * tool calls, file changes and approvals that wait for a Client's answer.
 *
 * Loaded only when `POLARIS_BENCH_HARNESS=1` (see `../registry.ts`); it then
 * stands in for every Harness kind. Never enabled in production.
 *
 * Each Turn follows a script: a prompt of the form `bench:{...json...}` sets
 * any field of `BenchTurnScript`; any other prompt gets `DEFAULT_SCRIPT`.
 * Every delta's text starts with `@<epoch ms>|`, the time it was emitted, so a
 * Client can measure Harness → Client latency.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ApprovalDecision, HarnessKind, RequestId, TurnId, TurnItem } from "@polaris/protocol"
import { type Cause, Deferred, Duration, Effect, Fiber, Queue, Stream } from "effect"
import type { HarnessDriver, HarnessEvent, HarnessSession, TurnInput } from "../HarnessDriver.ts"

export interface BenchTurnScript {
  /** Completed TurnItems per Turn; kinds rotate message, reasoning, command, tool call, file change. */
  readonly items: number
  /** Deltas streamed before each message, reasoning and command item completes. */
  readonly deltasPerItem: number
  /** Bytes of text per delta (including the timestamp prefix). */
  readonly deltaBytes: number
  /** Pause between deltas; 0 streams as fast as the engine takes them. */
  readonly deltaIntervalMs: number
  /** Every Nth item first asks for an approval and waits for the answer; 0 never asks. */
  readonly approvalEvery: number
  /** Files written under `<cwd>/polaris-bench/` during the Turn, so checkpoints see changes. */
  readonly touchFiles: number
  /** Minimum text size of each completed message, reasoning and command item (padded). */
  readonly itemBytes: number
  /** Wait before the Turn starts, e.g. to model a Harness thinking. */
  readonly startDelayMs: number
}

export const DEFAULT_SCRIPT: BenchTurnScript = {
  items: 5,
  deltasPerItem: 10,
  deltaBytes: 64,
  deltaIntervalMs: 5,
  approvalEvery: 0,
  touchFiles: 0,
  itemBytes: 0,
  startDelayMs: 0,
}

export const BENCH_PROMPT_PREFIX = "bench:"

export const parseScript = (prompt: string): BenchTurnScript => {
  if (!prompt.startsWith(BENCH_PROMPT_PREFIX)) return DEFAULT_SCRIPT
  try {
    const parsed = JSON.parse(prompt.slice(BENCH_PROMPT_PREFIX.length)) as Partial<BenchTurnScript>
    return { ...DEFAULT_SCRIPT, ...parsed }
  } catch {
    return DEFAULT_SCRIPT
  }
}

const nowMs = () => performance.timeOrigin + performance.now()

const deltaText = (bytes: number): string => {
  const head = `@${nowMs().toFixed(3)}|`
  return bytes > head.length ? head + "x".repeat(bytes - head.length) : head
}

const itemFor = (
  kind: number,
  id: string,
  text: string,
  cwd: string,
  files: ReadonlyArray<string>,
): TurnItem => {
  switch (kind) {
    case 0:
      return { _tag: "AssistantMessage", id, text }
    case 1:
      return { _tag: "Reasoning", id, text }
    case 2:
      return {
        _tag: "CommandExecution",
        id,
        command: "bun test",
        cwd,
        output: text,
        exitCode: 0,
        status: "completed",
      }
    case 3:
      return {
        _tag: "ToolCall",
        id,
        name: "read_file",
        input: { path: "src/index.ts" },
        output: { lines: 120 },
        status: "completed",
      }
    default:
      return {
        _tag: "FileChange",
        id,
        changes: (files.length > 0 ? files : ["src/index.ts"]).map((path) => ({
          path,
          kind: "modify" as const,
        })),
        status: "completed",
      }
  }
}

export const makeBenchDriver = (kind: HarnessKind): HarnessDriver => ({
  kind,
  capabilities: { steer: true, liveCoAttach: true },
  probe: Effect.succeed({ available: true, version: "bench", detail: "scripted bench Harness" }),
  open: (options) =>
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      const events = yield* Queue.unbounded<HarnessEvent, Cause.Done>()
      const approvals = new Map<RequestId, Deferred.Deferred<ApprovalDecision>>()
      let current: { readonly turnId: TurnId; readonly fiber: Fiber.Fiber<void> } | null = null
      let turns = 0
      const emit = (event: HarnessEvent) => Queue.offer(events, event)

      yield* Effect.addFinalizer(() => Queue.end(events))

      const runTurn = (input: TurnInput) =>
        Effect.gen(function* () {
          const script = parseScript(input.prompt)
          const { turnId } = input
          turns++
          if (turns === 1) {
            yield* emit({
              _tag: "CursorAssigned",
              cursor: options.resumeCursor ?? `bench-${options.sessionId}`,
            })
          }
          if (script.startDelayMs > 0) yield* Effect.sleep(Duration.millis(script.startDelayMs))
          yield* emit({ _tag: "TurnStarted", turnId })

          const files: Array<string> = []
          if (script.touchFiles > 0) {
            const dir = join(options.cwd, "polaris-bench")
            mkdirSync(dir, { recursive: true })
            for (let f = 0; f < script.touchFiles; f++) {
              const path = join("polaris-bench", `file-${f}.txt`)
              writeFileSync(join(options.cwd, path), `${turnId} ${f}\n`.repeat(20))
              files.push(path)
            }
          }

          for (let i = 0; i < script.items; i++) {
            const itemId = `${turnId}-item-${i}`
            const kindIndex = i % 5
            if (script.approvalEvery > 0 && (i + 1) % script.approvalEvery === 0) {
              const requestId = `${itemId}-approval` as RequestId
              const answer = yield* Deferred.make<ApprovalDecision>()
              approvals.set(requestId, answer)
              yield* emit({
                _tag: "ApprovalRequested",
                turnId,
                requestId,
                kind: "command",
                title: "Run bun test",
                detail: "bun test --coverage",
                options: [],
              })
              yield* Deferred.await(answer)
              approvals.delete(requestId)
            }
            let text = ""
            if (kindIndex <= 2) {
              for (let d = 0; d < script.deltasPerItem; d++) {
                const chunk = deltaText(script.deltaBytes)
                text += chunk
                yield* emit({
                  _tag: "ItemDelta",
                  turnId,
                  itemId,
                  field: kindIndex === 2 ? "output" : "text",
                  text: chunk,
                })
                if (script.deltaIntervalMs > 0) {
                  yield* Effect.sleep(Duration.millis(script.deltaIntervalMs))
                } else {
                  yield* Effect.yieldNow
                }
              }
            }
            if (text.length < script.itemBytes) text += "y".repeat(script.itemBytes - text.length)
            yield* emit({
              _tag: "ItemCompleted",
              turnId,
              item: itemFor(kindIndex, itemId, text || `item ${i}`, options.cwd, files),
            })
          }
          yield* emit({ _tag: "TurnEnded", turnId, status: "completed", error: null })
        }).pipe(
          Effect.onInterrupt(() =>
            emit({ _tag: "TurnEnded", turnId: input.turnId, status: "interrupted", error: null }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              if (current?.turnId === input.turnId) current = null
            }),
          ),
        )

      const session: HarnessSession = {
        events: Stream.fromQueue(events),
        sendTurn: (input) =>
          Effect.gen(function* () {
            const fiber = yield* Effect.forkIn(runTurn(input), scope)
            current = { turnId: input.turnId, fiber }
          }),
        steer: () => Effect.void,
        interrupt: Effect.suspend(() =>
          current === null ? Effect.void : Fiber.interrupt(current.fiber),
        ),
        respond: (requestId, decision) =>
          Effect.suspend(() => {
            const answer = approvals.get(requestId)
            return answer === undefined ? Effect.void : Deferred.succeed(answer, decision)
          }).pipe(Effect.asVoid),
        setPermissionMode: () => Effect.void,
        terminalCommand: Effect.succeed(["sh"]),
      }
      return session
    }),
})
