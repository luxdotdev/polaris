/**
 * A real Claude Code Turn (2.1.286, haiku) that ran one foreground Subagent,
 * recorded by `subagentRecord.e2e.test.ts` and scrubbed: the Subagent's
 * own command and final report must come out as its items, and the Agent call
 * must carry the report back to the Turn.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { TurnId, TurnItem } from "@polaris/protocol";
import { HarnessEvent } from "../HarnessDriver.ts";
import { ClaudeTranslator } from "./translate.ts";

const lines = readFileSync(join(import.meta.dir, "fixtures", "subagent-turn.jsonl"), "utf8")
  .trim()
  .split("\n");

// SAFETY: the fixture is a recording of the SDK's own messages, one per line.
const frames = lines.map((line) => JSON.parse(line) as SDKMessage);

const replay = () => {
  const translator = new ClaudeTranslator("/work/repo", null, () => "2026-10-01T00:00:00.000Z");

  translator.beginTurn(TurnId.make("t1"));

  return frames.flatMap((frame) => translator.onMessage(frame));
};

const completed = (events: ReadonlyArray<HarnessEvent>) =>
  events.filter(HarnessEvent.$is("ItemCompleted"));

describe("a recorded Subagent run", () => {
  test("the Subagent's command and final report are its own items", () => {
    const events = replay();
    const started = events.find(HarnessEvent.$is("SubagentStarted"));

    expect(started?.title).toBe("List files and report back");
    const own = completed(events).filter((e) => e.subagentId === started?.subagentId);

    expect(own.map((e) => e.item._tag)).toEqual(["CommandExecution", "AssistantMessage"]);
    const report = own.at(-1)?.item;

    expect(TurnItem.guards.AssistantMessage(report) ? report.text : "").toContain("pong");
    expect(events.find(HarnessEvent.$is("SubagentEnded"))).toMatchObject({ status: "completed" });
  });

  test("the Agent call ends after the Subagent, carrying its report to the Turn", () => {
    const events = replay();
    const ended = events.findIndex(HarnessEvent.$is("SubagentEnded"));

    const agent = completed(events).find(
      (e) => e.subagentId === undefined && TurnItem.guards.ToolCall(e.item)
    );

    expect(events.indexOf(agent ?? events[0]!)).toBeGreaterThan(ended);
    expect(JSON.stringify(agent?.item)).toContain("pong");
  });
});
