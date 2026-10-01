import { describe, expect, test } from "bun:test";
import { SessionId, Subagent, SubagentId, TurnId, TurnItem } from "@polaris/protocol";
import type { SubagentView } from "../../../store/sessionModel.ts";
import { resultText, subagentCard } from "./subagents.ts";

const I = TurnItem.cases;

const subagent = (status: "working" | "completed") =>
  new Subagent({
    id: SubagentId.make("toolu_agent"),
    sessionId: SessionId.make("s1"),
    turnId: TurnId.make("t1"),
    parentItemId: "toolu_agent",
    title: "List files and report back",
    agent: "general-purpose",
    model: null,
    status,
    startedAt: "2026-10-01T00:00:00.000Z",
    endedAt: status === "working" ? null : "2026-10-01T00:00:12.000Z",
  });

const ls = I.CommandExecution.make({
  id: "c1",
  command: "ls -la",
  cwd: "/r",
  output: "",
  exitCode: 0,
  status: "completed",
});

const report = I.AssistantMessage.make({ id: "m1", text: "Empty directory. pong." });

const call = I.ToolCall.make({
  id: "toolu_agent",
  name: "Agent",
  input: { description: "List files", prompt: "List the files, then say pong." },
  output: { status: "completed", content: [{ type: "text", text: "From the call: pong." }] },
  status: "completed",
});

const view = (
  status: "working" | "completed",
  items: ReadonlyArray<TurnItem>,
  live: SubagentView["live"] = new Map()
): SubagentView => ({
  subagent: subagent(status),
  items,
  live,
});

describe("subagent cards", () => {
  test("a finished Subagent's last message is its report, kept apart from its transcript", () => {
    const card = subagentCard(view("completed", [ls, report]), call);

    expect(card.report).toBe(report.text);
    expect(card.task).toBe("List the files, then say pong.");
    expect(card.entries.map((e) => (e.kind === "item" ? e.item.id : e.kind))).toEqual(["c1"]);
    expect(card.activity).toBeNull();
  });

  test("with no message, the report is what its Agent call returned", () => {
    expect(subagentCard(view("completed", [ls]), call).report).toBe("From the call: pong.");
  });

  test("while it works: no report, and a line on what it is doing", () => {
    const live = new Map([
      [
        "c2",
        {
          item: I.CommandExecution.make({
            ...ls,
            id: "c2",
            command: "bun test",
            status: "running",
          }),
          text: "",
          output: "",
        },
      ],
    ]);

    const card = subagentCard(view("working", [ls, report], live), call);

    expect(card.report).toBeNull();
    expect(card.activity).toBe("Running bun test");
  });

  test("result text from a string or text parts", () => {
    expect(resultText("done")).toBe("done");
    expect(
      resultText({
        content: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }],
      })
    ).toBe("a\n\nb");
    expect(resultText({ status: "completed" })).toBeNull();
  });
});
