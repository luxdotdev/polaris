import { describe, expect, test } from "bun:test";
import { SessionId, TurnId, TurnItem } from "@polaris/protocol";
import { Effect, Exit, Scope, Stream } from "effect";
import { HarnessEvent } from "../HarnessDriver.ts";
import { makeClaudeDriver } from "./ClaudeDriver.ts";
import { assistant, compactBoundary, FakeClaude, result, streamEvent } from "./fakeClaude.ts";

const T1 = TurnId.make("turn-1");

/** A Claude session on the fake, with one Turn sent; `events` collects what the driver emits. */
const openWithTurn = async (resumeCursor: string | null = null) => {
  const fake = new FakeClaude();
  fake.contextReply = { totalTokens: 50_000, maxTokens: 200_000 };
  const scope = Effect.runSync(Scope.make());

  const session = await Effect.runPromise(
    makeClaudeDriver({ query: fake.query, claudePath: () => "/opt/bin/claude" })
      .open({
        sessionId: SessionId.make("s1"),
        cwd: "/work",
        permissionMode: "full-access",
        model: null,
        effort: null,
        resumeCursor,
      })
      .pipe(Scope.provide(scope))
  );

  const events: HarnessEvent[] = [];
  Effect.runFork(Stream.runForEach(session.events, (e) => Effect.sync(() => events.push(e))));
  await Effect.runPromise(
    session.sendTurn({ turnId: T1, prompt: "go", attachments: [], model: null, effort: null })
  );
  const uuid = (await fake.nextInput(0)).uuid!;

  return {
    fake,
    events,
    uuid,
    settle: () => Bun.sleep(5),
    of: <T extends HarnessEvent["_tag"]>(tag: T) => events.filter(HarnessEvent.$is(tag)),
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  };
};

type Json = Parameters<typeof streamEvent>[0];

const block = (type: string, index: number, extra: Record<string, Json> = {}) =>
  streamEvent({ type, index, ...extra });

describe("Claude thinking", () => {
  test("a thinking block is live from its start and completes with when it ran", async () => {
    const t = await openWithTurn();
    t.fake.emit(streamEvent({ type: "message_start", message: { id: "m1" } }));
    t.fake.emit(block("content_block_start", 0, { content_block: { type: "thinking" } }));
    t.fake.emit(
      block("content_block_delta", 0, { delta: { type: "thinking_delta", thinking: "Hmm" } })
    );
    await Bun.sleep(20);
    t.fake.emit(block("content_block_stop", 0));
    t.fake.emit(assistant("m1", [{ type: "thinking", thinking: "Hmm, yes." }]));
    await t.settle();

    const [live] = t.of("ItemUpdated");
    expect(live?.item).toMatchObject({ id: "m1:0", text: "", endedAt: null });
    const [done] = t.of("ItemCompleted");
    const item = done?.item;

    if (item === undefined || !TurnItem.guards.Reasoning(item)) throw new Error("no reasoning");
    expect(item).toMatchObject({ id: "m1:0", text: "Hmm, yes." });
    const ran = Date.parse(item.endedAt ?? "") - Date.parse(item.startedAt ?? "");
    expect(ran).toBeGreaterThanOrEqual(15);
    await t.close();
  });

  test("thinking that streamed nothing still leaves its timed row; unseen thinking has no times", async () => {
    const t = await openWithTurn();
    t.fake.emit(streamEvent({ type: "message_start", message: { id: "m1" } }));
    t.fake.emit(block("content_block_start", 0, { content_block: { type: "thinking" } }));
    t.fake.emit(block("content_block_stop", 0));
    t.fake.emit(assistant("m1", [{ type: "thinking", thinking: "" }]));
    t.fake.emit(assistant("m2", [{ type: "thinking", thinking: "Unstreamed." }]));
    await t.settle();

    const done = t.of("ItemCompleted").map((e) => e.item);
    expect(done[0]).toMatchObject({ id: "m1:0", text: "" });
    expect(done[0]).not.toMatchObject({ startedAt: null });
    expect(done[1]).toMatchObject({ id: "m2:0", startedAt: null, endedAt: null });
    await t.close();
  });
});

describe("Claude plan details", () => {
  test("a todo's activeForm is its step's detail, unless it repeats the text", async () => {
    const t = await openWithTurn();

    const todos = [
      { content: "Run the tests", status: "in_progress", activeForm: "Running the tests" },
      { content: "Ship", status: "pending", activeForm: "Ship" },
      { content: "Read", status: "completed" },
    ];

    t.fake.emit(
      assistant("m1", [{ type: "tool_use", id: "tu1", name: "TodoWrite", input: { todos } }])
    );
    await t.settle();

    expect(t.of("ItemUpdated")[0]?.item).toMatchObject({
      steps: [
        { text: "Run the tests", status: "in-progress", detail: "Running the tests" },
        { text: "Ship", status: "pending", detail: null },
        { text: "Read", status: "completed", detail: null },
      ],
      explanation: null,
    });
    await t.close();
  });
});

describe("Claude context usage", () => {
  const usage = { input_tokens: 10, cache_read_input_tokens: 30_000, output_tokens: 90 };

  test("each model call reports its tokens; the result and getContextUsage set the window", async () => {
    const t = await openWithTurn();
    t.fake.emit(assistant("m1", [{ type: "text", text: "Hi" }], usage));
    t.fake.emit(assistant("m1", [{ type: "text", text: "again" }], usage));
    await t.settle();
    // A repeat of the same count (one message's blocks) reports once; the window isn't known yet.
    expect(t.of("ContextUsed")).toEqual([
      HarnessEvent.ContextUsed({ usedTokens: 30_100, windowTokens: null }),
    ]);

    t.fake.emit(result([t.uuid], { modelUsage: { "claude-x": { contextWindow: 200_000 } } }));
    await t.settle();

    expect(t.fake.contextCalls).toBe(1);
    expect(t.of("ContextUsed").slice(1)).toEqual([
      HarnessEvent.ContextUsed({ usedTokens: 30_100, windowTokens: 200_000 }),
      HarnessEvent.ContextUsed({ usedTokens: 50_000, windowTokens: 200_000 }),
    ]);
    await t.close();
  });

  test("a compaction reports what is left; a resumed session asks at once", async () => {
    const t = await openWithTurn("claude-session-1");
    await t.settle();
    expect(t.fake.contextCalls).toBe(1);

    t.fake.emit(compactBoundary(180_000, 20_000));
    await t.settle();

    expect(t.of("ContextUsed").at(-1)).toEqual(
      HarnessEvent.ContextUsed({ usedTokens: 20_000, windowTokens: 200_000 })
    );
    await t.close();
  });
});
