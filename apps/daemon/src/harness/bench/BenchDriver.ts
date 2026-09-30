/**
 * A scripted Harness for benchmarks (`packages/bench`). It spends no tokens and
 * runs no vendor process, but emits realistic Turns through the real engine,
 * store, streams and transport: streamed deltas at a set rate, command output,
 * tool calls, file changes and approvals that wait for a Client's answer.
 *
 * Loaded only when `POLARIS_BENCH_HARNESS=1` (see `../registry.ts`); it then
 * stands in for Claude Code and Codex (`./kinds.ts`). Never enabled in production.
 *
 * Each Turn follows a script: a prompt of the form `bench:{...json...}` sets
 * any field of `BenchTurnScript`; any other prompt gets `DEFAULT_SCRIPT`.
 * Every delta's text starts with `@<epoch ms>|`, the time it was emitted, so a
 * Client can measure Harness → Client latency.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ApprovalDecision,
  type HarnessKind,
  Model,
  RequestId,
  type TurnId,
  TurnItem,
} from "@polaris/protocol";
import {
  type Cause,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Option,
  Queue,
  Schema,
  Stream,
  Struct,
} from "effect";
import {
  type HarnessDriver,
  HarnessEvent,
  type HarnessSession,
  type OpenOptions,
  type TurnInput,
} from "../HarnessDriver.ts";

const BenchTurnScriptSchema = Schema.Struct({
  /** Completed TurnItems per Turn; kinds rotate message, reasoning, command, tool call, file change. */
  items: Schema.Number,
  /** Deltas streamed before each message, reasoning and command item completes. */
  deltasPerItem: Schema.Number,
  /** Bytes of text per delta (including the timestamp prefix). */
  deltaBytes: Schema.Number,
  /** Pause between deltas; 0 streams as fast as the engine takes them. */
  deltaIntervalMs: Schema.Number,
  /** Every Nth item first asks for an approval and waits for the answer; 0 never asks. */
  approvalEvery: Schema.Number,
  /** Files written under `<cwd>/polaris-bench/` during the Turn, so checkpoints see changes. */
  touchFiles: Schema.Number,
  /** Minimum text size of each completed message, reasoning and command item (padded). */
  itemBytes: Schema.Number,
  /** Wait before the Turn starts, e.g. to model a Harness thinking. */
  startDelayMs: Schema.Number,
});

export type BenchTurnScript = typeof BenchTurnScriptSchema.Type;

export const DEFAULT_SCRIPT: BenchTurnScript = {
  items: 5,
  deltasPerItem: 10,
  deltaBytes: 64,
  deltaIntervalMs: 5,
  approvalEvery: 0,
  touchFiles: 0,
  itemBytes: 0,
  startDelayMs: 0,
};

export const BENCH_PROMPT_PREFIX = "bench:";

const decodeScriptOverrides = Schema.decodeUnknownOption(
  Schema.fromJsonString(BenchTurnScriptSchema.mapFields(Struct.map(Schema.optionalKey)))
);

export const parseScript = (prompt: string): BenchTurnScript => {
  if (!prompt.startsWith(BENCH_PROMPT_PREFIX)) return DEFAULT_SCRIPT;

  return Option.match(decodeScriptOverrides(prompt.slice(BENCH_PROMPT_PREFIX.length)), {
    onNone: () => DEFAULT_SCRIPT,
    onSome: (overrides) => ({ ...DEFAULT_SCRIPT, ...overrides }),
  });
};

const nowMs = () => performance.timeOrigin + performance.now();

const deltaText = (bytes: number): string => {
  const head = `@${nowMs().toFixed(3)}|`;

  return bytes > head.length ? head + "x".repeat(bytes - head.length) : head;
};

interface ItemSeed {
  readonly id: string;
  readonly text: string;
  /** When a reasoning item began streaming; it ends as it completes. */
  readonly startedAt: string;
  readonly cwd: string;
  readonly files: ReadonlyArray<string>;
}

/** The stand-in Model's context window, and how much of it each Turn fills. */
const BENCH_CONTEXT_WINDOW = 200_000;

const BENCH_CONTEXT_PER_TURN = 30_000;

/** Kinds rotate message, reasoning, command, tool call, file change. */
const ITEM_KINDS = 5;

/** Kinds 0–2 (message, reasoning, command) stream deltas before they complete. */
const STREAMED_KINDS = 3;

const itemFor = (kind: number, seed: ItemSeed): TurnItem => {
  const { id, text, cwd, files, startedAt } = seed;

  switch (kind) {
    case 0:
      return TurnItem.cases.AssistantMessage.make({ id, text });
    case 1:
      return TurnItem.cases.Reasoning.make({
        id,
        text,
        startedAt,
        endedAt: new Date().toISOString(),
      });
    case 2:
      return TurnItem.cases.CommandExecution.make({
        id,
        command: "bun test",
        cwd,
        output: text,
        exitCode: 0,
        status: "completed",
      });
    case 3:
      return TurnItem.cases.ToolCall.make({
        id,
        name: "read_file",
        input: { path: "src/index.ts" },
        output: { lines: 120 },
        status: "completed",
      });
    default:
      return TurnItem.cases.FileChange.make({
        id,
        changes: (files.length > 0 ? files : ["src/index.ts"]).map((path) => ({
          path,
          kind: "modify" as const,
        })),
        status: "completed",
      });
  }
};

const { ItemDelta } = HarnessEvent;

const touchFiles = (cwd: string, turnId: TurnId, count: number): ReadonlyArray<string> => {
  if (count <= 0) return [];
  mkdirSync(join(cwd, "polaris-bench"), { recursive: true });

  return Array.from({ length: count }, (_, f) => {
    const path = join("polaris-bench", `file-${f}.txt`);
    writeFileSync(join(cwd, path), `${turnId} ${f}\n`.repeat(20));

    return path;
  });
};

const openBenchSession = Effect.fn("BenchDriver.open")(function* (options: OpenOptions) {
  const scope = yield* Effect.scope;
  const events = yield* Queue.unbounded<HarnessEvent, Cause.Done>();
  const approvals = new Map<RequestId, Deferred.Deferred<ApprovalDecision>>();
  let current: { readonly turnId: TurnId; readonly fiber: Fiber.Fiber<void> } | null = null;
  let turns = 0;
  const emit = (event: HarnessEvent) => Queue.offer(events, event);

  yield* Effect.addFinalizer(() => Queue.end(events));

  const awaitApproval = Effect.fnUntraced(function* (turnId: TurnId, itemId: string) {
    const requestId = RequestId.make(`${itemId}-approval`);
    const answer = yield* Deferred.make<ApprovalDecision>();
    approvals.set(requestId, answer);
    yield* emit(
      HarnessEvent.ApprovalRequested({
        turnId,
        requestId,
        kind: "command",
        title: "Run bun test",
        detail: "bun test --coverage",
        options: [],
      })
    );
    yield* Deferred.await(answer);
    approvals.delete(requestId);
  });

  /** Streams the item's deltas and returns their text. */
  const streamDeltas = Effect.fnUntraced(function* (
    script: BenchTurnScript,
    turnId: TurnId,
    itemId: string,
    field: "text" | "output"
  ) {
    let text = "";

    for (let d = 0; d < script.deltasPerItem; d++) {
      const chunk = deltaText(script.deltaBytes);
      text += chunk;
      yield* emit(ItemDelta({ turnId, itemId, field, text: chunk }));

      if (script.deltaIntervalMs > 0) {
        yield* Effect.sleep(Duration.millis(script.deltaIntervalMs));
      } else {
        yield* Effect.yieldNow;
      }
    }

    return text;
  });

  const runItem = Effect.fnUntraced(function* (
    script: BenchTurnScript,
    turnId: TurnId,
    i: number,
    files: ReadonlyArray<string>
  ) {
    const itemId = `${turnId}-item-${i}`;
    const kindIndex = i % ITEM_KINDS;

    if (script.approvalEvery > 0 && (i + 1) % script.approvalEvery === 0) {
      yield* awaitApproval(turnId, itemId);
    }

    const startedAt = new Date().toISOString();

    let text =
      kindIndex < STREAMED_KINDS
        ? yield* streamDeltas(script, turnId, itemId, kindIndex === 2 ? "output" : "text")
        : "";

    if (text.length < script.itemBytes) text += "y".repeat(script.itemBytes - text.length);

    const item = itemFor(kindIndex, {
      id: itemId,
      text: text || `item ${i}`,
      startedAt,
      cwd: options.cwd,
      files,
    });

    yield* emit(HarnessEvent.ItemCompleted({ turnId, item }));
  });

  const runTurn = (input: TurnInput) =>
    Effect.gen(function* () {
      const script = parseScript(input.prompt);
      const { turnId } = input;
      turns++;

      if (turns === 1) {
        yield* emit(
          HarnessEvent.CursorAssigned({
            cursor: options.resumeCursor ?? `bench-${options.sessionId}`,
          })
        );
      }

      if (script.startDelayMs > 0) yield* Effect.sleep(Duration.millis(script.startDelayMs));
      yield* emit(HarnessEvent.TurnStarted({ turnId, prompt: input.prompt }));
      const files = touchFiles(options.cwd, turnId, script.touchFiles);

      for (let i = 0; i < script.items; i++) yield* runItem(script, turnId, i, files);

      yield* emit(
        HarnessEvent.ContextUsed({
          usedTokens: Math.min(BENCH_CONTEXT_WINDOW, turns * BENCH_CONTEXT_PER_TURN),
          windowTokens: BENCH_CONTEXT_WINDOW,
        })
      );
      yield* emit(HarnessEvent.TurnEnded({ turnId, status: "completed", error: null }));
    }).pipe(
      Effect.onInterrupt(() =>
        emit(HarnessEvent.TurnEnded({ turnId: input.turnId, status: "interrupted", error: null }))
      ),
      Effect.ensuring(
        Effect.sync(() => {
          if (current?.turnId === input.turnId) current = null;
        })
      )
    );

  const session: HarnessSession = {
    events: Stream.fromQueue(events),
    sendTurn: (input) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkIn(runTurn(input), scope);
        current = { turnId: input.turnId, fiber };
      }),
    steer: (text) =>
      current === null
        ? Effect.void
        : emit(
            HarnessEvent.ItemCompleted({
              turnId: current.turnId,
              item: TurnItem.cases.UserMessage.make({ id: `steer:${crypto.randomUUID()}`, text }),
            })
          ).pipe(Effect.asVoid),
    interrupt: Effect.suspend(() =>
      current === null ? Effect.void : Fiber.interrupt(current.fiber)
    ),
    respond: (requestId, decision) =>
      Effect.suspend(() => {
        const answer = approvals.get(requestId);

        return answer === undefined ? Effect.void : Deferred.succeed(answer, decision);
      }).pipe(Effect.asVoid),
    setPermissionMode: () => Effect.void,
    terminalCommand: Effect.succeed(["sh"]),
  };

  return session;
});

/** Two stand-in Models, so Clients can exercise the picker against a bench Daemon. */
const BENCH_MODELS = [
  new Model({
    id: "bench-large",
    name: "Bench Large",
    description: null,
    efforts: ["low", "medium", "high"],
    defaultEffort: "medium",
    isDefault: true,
  }),
  new Model({
    id: "bench-small",
    name: "Bench Small",
    description: null,
    efforts: [],
    defaultEffort: null,
    isDefault: false,
  }),
];

export const makeBenchDriver = (kind: HarnessKind): HarnessDriver => ({
  kind,
  capabilities: { steer: true, liveCoAttach: true, switchModel: true },
  probe: Effect.succeed({ available: true, version: "bench", detail: "scripted bench Harness" }),
  listModels: Effect.succeed(BENCH_MODELS),
  open: openBenchSession,
});
