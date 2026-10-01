/**
 * Subagents in the session model (R6 bug: "when a subagent completes, we lose
 * the final output"). Mirrors a recorded Claude Code run (the daemon's
 * `claude/fixtures/subagent-turn.jsonl`): the Subagent streams its report,
 * completes it, ends; the Agent call completes; the Turn ends.
 */
import { describe, expect, test } from "bun:test";
import {
  type DomainEvent,
  DomainEvent as Events,
  SessionStreamItem,
  Subagent,
  SubagentDetail,
  SubagentId,
  TurnDetail,
  TurnItem,
} from "@polaris/protocol";
import { applySessionItems, emptySessionModel } from "./sessionModel.ts";
import {
  at,
  envelope,
  seq,
  session,
  sessionId,
  turn,
  turnId,
  turnWith,
} from "./fixtures.testing.ts";

const S = SessionStreamItem.cases;

const E = Events.cases;

const I = TurnItem.cases;

const event = (sequence: number, e: DomainEvent) =>
  S.Event.make({ envelope: envelope(sequence, e) });

const subagentId = SubagentId.make("toolu_agent");

const subagent = (status: "working" | "completed") =>
  new Subagent({
    id: subagentId,
    sessionId,
    turnId,
    parentItemId: "toolu_agent",
    title: "List files and report back",
    agent: "general-purpose",
    model: null,
    status,
    startedAt: at,
    endedAt: status === "working" ? null : at,
  });

const report = I.AssistantMessage.make({ id: "msg_sub:1", text: "The directory is empty. pong." });

const command = I.CommandExecution.make({
  id: "toolu_ls",
  command: "ls -la",
  cwd: "/work/repo",
  output: "total 0",
  exitCode: 0,
  status: "completed",
});

const agentCall = I.ToolCall.make({
  id: "toolu_agent",
  name: "Agent",
  input: { description: "List files and report back" },
  output: { status: "completed", content: [{ type: "text", text: report.text }] },
  status: "completed",
});

const run = applySessionItems(
  emptySessionModel,
  structuredClone([
    S.Snapshot.make({ sequence: seq(2), session, turns: [], pendingApprovals: [] }),
    S.Synchronized.make({ sequence: seq(2) }),
    event(3, E.TurnStarted.make({ turn })),
    event(4, E.SubagentStarted.make({ subagent: subagent("working") })),
    event(5, E.TurnItemCompleted.make({ sessionId, turnId, item: command, subagentId })),
    S.Delta.make({ turnId, itemId: report.id, field: "text", text: "The directory", subagentId }),
  ])
);

const ended = applySessionItems(
  run,
  structuredClone([
    event(6, E.TurnItemCompleted.make({ sessionId, turnId, item: report, subagentId })),
    event(7, E.SubagentEnded.make({ subagent: subagent("completed") })),
    event(8, E.TurnItemCompleted.make({ sessionId, turnId, item: agentCall, subagentId: null })),
    event(9, E.TurnEnded.make({ turn: turnWith({ status: "completed" }) })),
  ])
);

describe("Subagents in the session model", () => {
  test("a Subagent's streaming text is its own, never the Turn's", () => {
    const view = run.turns[0];

    expect(view?.live.size).toBe(0);
    expect(view?.subagents[0]?.live.get(report.id)?.text).toBe("The directory");
    expect(view?.subagents[0]?.items).toEqual([command]);
  });

  test("its final report survives the Subagent and the Turn ending", () => {
    const view = ended.turns[0];

    expect(view?.subagents[0]?.subagent.status).toBe("completed");
    expect(view?.subagents[0]?.items).toEqual([command, report]);
    expect(view?.subagents[0]?.live.size).toBe(0);
    expect(view?.items).toEqual([agentCall]);
  });

  test("a snapshot brings each Turn's Subagents with their items", () => {
    const model = applySessionItems(
      emptySessionModel,
      structuredClone([
        S.Snapshot.make({
          sequence: seq(9),
          session,
          pendingApprovals: [],
          turns: [
            new TurnDetail({
              turn: turnWith({ status: "completed" }),
              items: [agentCall],
              subagents: [
                new SubagentDetail({ subagent: subagent("completed"), items: [command, report] }),
              ],
            }),
          ],
        }),
      ])
    );

    expect(model.turns[0]?.subagents[0]?.items).toEqual([command, report]);
  });
});
