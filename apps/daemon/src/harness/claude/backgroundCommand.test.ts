/** `BackgroundCommand` on Claude: Ctrl-B through the Agent SDK, and the command's row after it. */
import { expect, test } from "bun:test";
import { SessionId, TurnId, TurnItem } from "@polaris/protocol";
import { Effect, Exit, Scope, Stream } from "effect";
import { HarnessEvent } from "../HarnessDriver.ts";
import { unstamped } from "../itemClock.testing.ts";
import { makeClaudeDriver } from "./ClaudeDriver.ts";
import { assistant, FakeClaude, toolResult } from "./fakeClaude.ts";

const T1 = TurnId.make("turn-1");

const open = async () => {
  const fake = new FakeClaude();
  const driver = makeClaudeDriver({ query: fake.query, claudePath: () => "/opt/bin/claude" });
  const scope = Effect.runSync(Scope.make());

  const session = await Effect.runPromise(
    driver
      .open({
        sessionId: SessionId.make("session-1"),
        cwd: "/work/repo",
        permissionMode: "supervised",
        model: null,
        effort: null,
        resumeCursor: null,
      })
      .pipe(Scope.provide(scope))
  );

  const events: HarnessEvent[] = [];
  Effect.runFork(
    Stream.runForEach(session.events, (e) => Effect.sync(() => events.push(unstamped(e))))
  );
  await Effect.runPromise(
    session.sendTurn({ turnId: T1, prompt: "start it", attachments: [], model: null, effort: null })
  );

  const until = async (predicate: () => boolean) => {
    for (let i = 0; i < 400 && !predicate(); i++) await Bun.sleep(2);
  };

  return {
    fake,
    session,
    events,
    until,
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  };
};

test("a command moves to the background by its tool_use id, and its row ends in the background", async () => {
  const t = await open();
  t.fake.emit(
    assistant("m1", [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: "bun dev" } }])
  );
  await t.until(() => t.events.some(HarnessEvent.$is("ItemUpdated")));
  const moved = await Effect.runPromise(t.session.backgroundCommand!("tu1"));

  // What Claude Code answers for the tool call once the user backgrounded it.
  t.fake.emit(
    toolResult("tu1", "Command was manually backgrounded by user with ID: b1.", {
      structured: {
        stdout: "ready on :3000",
        stderr: "",
        interrupted: false,
        backgroundTaskId: "b1",
        backgroundedByUser: true,
      },
    })
  );
  await t.until(() => t.events.some(HarnessEvent.$is("ItemCompleted")));

  expect(moved).toBe(true);
  expect(t.fake.backgrounded).toEqual(["tu1"]);
  expect(t.events.find(HarnessEvent.$is("ItemCompleted"))?.item).toEqual(
    TurnItem.cases.CommandExecution.make({
      id: "tu1",
      command: "bun dev",
      cwd: "/work/repo",
      output: "ready on :3000",
      exitCode: null,
      status: "completed",
      backgroundTaskId: "b1",
    })
  );
  await t.close();
});

test("every foreground command moves without an id; none moving or a refusal comes back", async () => {
  const t = await open();
  const all = await Effect.runPromise(t.session.backgroundCommand!(null));
  t.fake.backgroundReply = false;
  const none = await Effect.runPromise(t.session.backgroundCommand!("tu9"));
  t.fake.backgroundReply = new Error("background tasks are disabled");
  const refused = await Effect.runPromiseExit(t.session.backgroundCommand!(null));

  expect(t.fake.backgrounded).toEqual([undefined, "tu9", undefined]);
  expect([all, none]).toEqual([true, false]);
  expect(JSON.stringify(refused)).toContain("Could not move the command to the background");
  await t.close();
});
