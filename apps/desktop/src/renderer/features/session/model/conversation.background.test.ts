import { expect, test } from "bun:test";
import { BackgroundTask, TurnId, TurnItem, TurnTrigger } from "@polaris/protocol";
import { turnWith } from "../../../store/fixtures.testing.ts";
import type { TurnView } from "../../../store/sessionModel.ts";
import { conversationRows, summarize } from "./conversation.ts";

const continuation = (index: number, items: ReadonlyArray<TurnItem> = []): TurnView => ({
  turn: turnWith({
    id: TurnId.make(`t${index}`),
    index,
    prompt: "[Background task continuation]",
    trigger: TurnTrigger.cases.BackgroundTasksReported.make({
      tasks: [
        { id: "a", kind: "subagent" },
        { id: "b", kind: "subagent" },
      ],
    }),
    status: "completed",
  }),
  items,
  live: new Map(),
  subagents: [],
});

const prompted: TurnView = {
  turn: turnWith({ id: TurnId.make("t0"), index: 0, prompt: "Fan out", status: "completed" }),
  items: [],
  live: new Map(),
  subagents: [],
};

test("a self-started Turn opens with what woke it, never a user bubble", () => {
  const rows = conversationRows({
    turns: [prompted, continuation(1)],
    approvals: [],
    unfolded: new Set(),
  });

  expect(rows.map((r) => r.kind)).toEqual(["summary", "trigger"]);
  expect(rows[1]).toMatchObject({ text: "2 subagents reported" });
  expect(JSON.stringify(rows)).not.toContain("[Background task continuation]");
});

test("folded, a self-started Turn without a message summarizes as its trigger", () => {
  expect(summarize(continuation(1)).summary).toBe("2 subagents reported");
  expect(
    summarize(continuation(1, [TurnItem.cases.AssistantMessage.make({ id: "m", text: "Both in" })]))
      .summary
  ).toBe("Both in");
});

test("background tasks an Idle session waits on close the list, before outgoing rows", () => {
  const tasks = [new BackgroundTask({ id: "x", kind: "command", description: "bun run bench" })];

  const rows = conversationRows({
    turns: [prompted],
    approvals: [],
    unfolded: new Set(),
    waiting: tasks,
  });

  expect(rows.at(-1)).toEqual({ kind: "waiting", key: "waiting", tasks });
});
