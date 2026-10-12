import { expect, test } from "bun:test";
import { BackgroundTask, TurnItem } from "@polaris/protocol";
import type { LiveItem } from "../../../store/sessionModel.ts";
import { type LiveTurn, runningCommands, runningPhrase } from "./running.ts";

const command = (id: string, status: "running" | "completed"): LiveItem => ({
  item: TurnItem.cases.CommandExecution.make({
    id,
    command: "sleep 20",
    cwd: "/repo",
    output: "",
    exitCode: null,
    status,
  }),
  text: "",
  output: "",
});

const tool = (id: string): LiveItem => ({
  item: TurnItem.cases.ToolCall.make({
    id,
    name: "Read",
    input: {},
    output: null,
    status: "running",
  }),
  text: "",
  output: "",
});

const turn = (live: ReadonlyArray<LiveItem>, subagent: ReadonlyArray<LiveItem> = []): LiveTurn => ({
  live: new Map(live.map((l, n) => [l.item?.id ?? `delta-${n}`, l])),
  subagents: [{ live: new Map(subagent.map((l) => [l.item?.id ?? "", l])) }],
});

const background = (id: string, kind: "command" | "subagent") =>
  new BackgroundTask({ id, kind, description: id });

test("counts the Turn's and its Subagents' running commands, not tools or streamed text", () => {
  const view = turn(
    [
      command("a", "running"),
      command("b", "completed"),
      tool("c"),
      { item: null, text: "x", output: "" },
    ],
    [command("d", "running")]
  );

  expect(runningCommands(view, [])).toBe(2);
});

test("adds background commands, once each, and leaves background Subagents out", () => {
  const view = turn([command("a", "running")]);

  expect(
    runningCommands(view, [
      background("a", "command"),
      background("shell-1", "command"),
      background("s", "subagent"),
    ])
  ).toBe(2);
  expect(runningCommands(undefined, [background("shell-1", "command")])).toBe(1);
});

test("the strip says how many, and nothing when none", () => {
  expect(runningPhrase(0)).toBeNull();
  expect(runningPhrase(1)).toBe("1 command running");
  expect(runningPhrase(3)).toBe("3 commands running");
});
