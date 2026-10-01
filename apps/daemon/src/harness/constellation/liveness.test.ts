import { expect, test } from "bun:test";
import {
  ContextUsage,
  DomainEvent,
  SessionId,
  SubagentId,
  TurnId,
  TurnItem,
} from "@polaris/protocol";
import { HarnessEvent } from "../HarnessDriver.ts";
import { emptyLiveness, observeLiveness, projectLiveness, restoreLiveness } from "./liveness.ts";

const turnId = TurnId.make("turn");

const command = (status: "running" | "completed") =>
  TurnItem.cases.CommandExecution.make({
    id: "cmd",
    command: "bun run bench",
    cwd: "/tmp",
    output: "",
    exitCode: null,
    status,
  });

test("elapsed time follows observed command start, not output or model progress", () => {
  let facts = observeLiveness(
    emptyLiveness(),
    HarnessEvent.ItemUpdated({ turnId, item: command("running") }),
    1000
  );

  facts = observeLiveness(
    facts,
    HarnessEvent.ItemUpdated({ turnId, item: command("running") }),
    2000
  );
  facts = observeLiveness(
    facts,
    HarnessEvent.ItemDelta({ turnId, itemId: "cmd", field: "output", text: "Working" }),
    4000
  );
  facts = observeLiveness(
    facts,
    HarnessEvent.ContextUsed({ usedTokens: 850, windowTokens: 1000 }),
    4500
  );
  const live = projectLiveness(facts, 5000, 2);
  expect(live.current).toMatchObject({ command: "bun run bench", elapsedMs: 4000 });
  expect(live.lastOutputAt).toBe(4000);
  expect(live.contextPercent).toBe(85);
  expect(live.queuedInput).toBe(2);
  facts = observeLiveness(
    facts,
    HarnessEvent.ItemCompleted({ turnId, item: command("completed") }),
    6000
  );
  expect(projectLiveness(facts, 7000, 0).current).toBeNull();
});

test("parallel tools retain original start; ending a Turn clears its activity, with no fabricated context", () => {
  let facts = observeLiveness(
    emptyLiveness(),
    HarnessEvent.ItemUpdated({ turnId, item: command("running") }),
    1000
  );

  facts = observeLiveness(
    facts,
    HarnessEvent.ItemUpdated({
      turnId,
      item: TurnItem.cases.ToolCall.make({
        id: "tool",
        name: "Read",
        input: {},
        output: null,
        status: "running",
      }),
    }),
    2000
  );
  facts = observeLiveness(
    facts,
    HarnessEvent.ItemUpdated({
      turnId,
      subagentId: SubagentId.make("sub"),
      item: TurnItem.cases.ToolCall.make({
        id: "subtool",
        name: "Search",
        input: {},
        output: null,
        status: "running",
      }),
    }),
    3000
  );
  expect(projectLiveness(facts, 5000, 0).current).toMatchObject({
    command: "Read",
    elapsedMs: 3000,
  });
  expect(projectLiveness(facts, 5000, 0).contextPercent).toBeNull();
  facts = observeLiveness(
    facts,
    HarnessEvent.TurnEnded({ turnId, status: "interrupted", error: null }),
    6000
  );
  expect(projectLiveness(facts, 7000, 0).current).toBeNull();
});

test("restart restores persisted context and output without inventing a running command", () => {
  let facts = restoreLiveness(
    emptyLiveness(),
    DomainEvent.cases.SessionContextUsed.make({
      sessionId: SessionId.make("s"),
      usage: new ContextUsage({ usedTokens: 85, windowTokens: 100 }),
    }),
    1000
  );

  facts = restoreLiveness(
    facts,
    DomainEvent.cases.TurnItemCompleted.make({
      sessionId: SessionId.make("s"),
      turnId,
      subagentId: null,
      item: command("completed"),
    }),
    2000
  );
  expect(projectLiveness(facts, 5000, 0)).toMatchObject({
    current: null,
    lastOutputAt: 2000,
    contextPercent: 85,
  });
});
