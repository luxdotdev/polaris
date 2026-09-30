import { describe, expect, test } from "bun:test";
import { SessionId, SubagentId, TurnId } from "@polaris/protocol";
import { Effect, Exit, Scope, Stream } from "effect";
import { HarnessEvent } from "../HarnessDriver.ts";
import { makeClaudeDriver } from "./ClaudeDriver.ts";
import {
  assistant,
  FakeClaude,
  inSubagent,
  result,
  taskNotification,
  taskStarted,
  toolResult,
} from "./fakeClaude.ts";

const T1 = TurnId.make("turn-1");

const AGENT = "toolu_agent";

const SUB = SubagentId.make(AGENT);

/** A Claude session on the fake, with one Turn sent; `events` collects what the driver emits. */
const openWithTurn = async () => {
  const fake = new FakeClaude();
  const scope = Effect.runSync(Scope.make());

  const session = await Effect.runPromise(
    makeClaudeDriver({ query: fake.query, claudePath: () => "/opt/bin/claude" })
      .open({
        sessionId: SessionId.make("s1"),
        cwd: "/work",
        permissionMode: "full-access",
        model: null,
        effort: null,
        resumeCursor: null,
      })
      .pipe(Scope.provide(scope))
  );

  const events: HarnessEvent[] = [];
  Effect.runFork(Stream.runForEach(session.events, (e) => Effect.sync(() => events.push(e))));
  await Effect.runPromise(
    session.sendTurn({ turnId: T1, prompt: "go", attachments: [], model: null, effort: null })
  );
  const uuid = (await fake.nextInput(0)).uuid!;

  const settle = () => Bun.sleep(5);

  /** What the driver emitted, as `tag subagent? detail`, without the Turn's start. */
  const trace = () =>
    events.flatMap((e) => {
      if (HarnessEvent.$is("TurnStarted")(e) || HarnessEvent.$is("CursorAssigned")(e)) return [];
      const sub = "subagentId" in e && e.subagentId !== undefined ? `[${e.subagentId}] ` : "";
      const item = "item" in e ? `${e.item._tag}:${"status" in e.item ? e.item.status : "-"}` : "";
      const status = HarnessEvent.$is("SubagentEnded")(e) ? e.status : "";

      return [`${e._tag} ${sub}${item}${status}`.trim()];
    });

  return {
    fake,
    events,
    trace,
    settle,
    uuid,
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  };
};

const agentCall = (background: boolean) =>
  assistant("m1", [
    {
      type: "tool_use",
      id: AGENT,
      name: "Agent",
      input: {
        description: "Check frame timing",
        prompt: "Measure it",
        subagent_type: "Explore",
        model: "haiku",
        run_in_background: background,
      },
    },
  ]);

describe("Claude Subagents", () => {
  test("a foreground Agent call is a Subagent with its own items, ending with the call", async () => {
    const t = await openWithTurn();
    t.fake.emit(agentCall(false));
    t.fake.emit(taskStarted(AGENT, "Check frame timing", { subagentType: "Explore" }));
    t.fake.emit(inSubagent(AGENT, assistant("sub-1", [{ type: "text", text: "Measuring" }])));
    t.fake.emit(
      inSubagent(
        AGENT,
        assistant("sub-2", [
          { type: "tool_use", id: "toolu_bash", name: "Bash", input: { command: "ls" } },
        ])
      )
    );
    t.fake.emit(inSubagent(AGENT, toolResult("toolu_bash", "a.txt")));
    t.fake.emit(toolResult(AGENT, "Timing is fine"));
    t.fake.emit(result([t.uuid]));
    await t.settle();

    expect(t.trace()).toEqual([
      "ItemUpdated ToolCall:running",
      `SubagentStarted [${SUB}]`,
      `ItemCompleted [${SUB}] AssistantMessage:-`,
      `ItemUpdated [${SUB}] CommandExecution:running`,
      `ItemCompleted [${SUB}] CommandExecution:completed`,
      "ItemCompleted ToolCall:completed",
      `SubagentEnded [${SUB}] completed`,
      "TurnEnded",
    ]);

    expect(t.events.find(HarnessEvent.$is("SubagentStarted"))).toMatchObject({
      turnId: T1,
      subagentId: SUB,
      parentItemId: AGENT,
      title: "Check frame timing",
      agent: "Explore",
      model: "haiku",
    });
    expect(t.fake.options?.forwardSubagentText).toBe(true);
    await t.close();
  });

  test("a background Subagent outlives its Turn and ends with its notification", async () => {
    const t = await openWithTurn();
    t.fake.emit(agentCall(true));
    t.fake.emit(taskStarted(AGENT, "Check frame timing", { background: true }));
    t.fake.emit(toolResult(AGENT, "Running in the background"));
    t.fake.emit(result([t.uuid]));
    await t.settle();
    // After the Turn: its frames still belong to it, and the notification ends it.
    t.fake.emit(inSubagent(AGENT, assistant("sub-1", [{ type: "text", text: "Done" }])));
    t.fake.emit(taskNotification(AGENT, "completed"));
    await t.settle();

    expect(t.trace()).toEqual([
      "ItemUpdated ToolCall:running",
      `SubagentStarted [${SUB}]`,
      "ItemCompleted ToolCall:completed",
      "TurnEnded",
      `ItemCompleted [${SUB}] AssistantMessage:-`,
      `SubagentEnded [${SUB}] completed`,
    ]);
    await t.close();
  });

  test("a stopped Subagent is interrupted and its open tool calls are declined", async () => {
    const t = await openWithTurn();
    t.fake.emit(agentCall(true));
    t.fake.emit(taskStarted(AGENT, "Check frame timing", { background: true }));
    t.fake.emit(
      inSubagent(
        AGENT,
        assistant("sub-1", [
          { type: "tool_use", id: "toolu_bash", name: "Bash", input: { command: "sleep 9" } },
        ])
      )
    );
    t.fake.emit(taskNotification(AGENT, "stopped"));
    await t.settle();

    expect(t.trace().slice(2)).toEqual([
      `ItemUpdated [${SUB}] CommandExecution:running`,
      `ItemCompleted [${SUB}] CommandExecution:declined`,
      `SubagentEnded [${SUB}] interrupted`,
    ]);
    await t.close();
  });

  test("frames and notifications for Subagents it never saw start are ignored", async () => {
    const t = await openWithTurn();
    // No Agent call behind this task, and a frame from an unknown parent.
    t.fake.emit(taskStarted("toolu_other", "Unrelated"));
    t.fake.emit(inSubagent("toolu_other", assistant("x", [{ type: "text", text: "?" }])));
    t.fake.emit(taskNotification("toolu_other", "completed"));
    await t.settle();

    expect(t.trace()).toEqual([]);
    await t.close();
  });
});
