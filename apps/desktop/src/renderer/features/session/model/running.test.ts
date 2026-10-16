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

const ids = (running: ReadonlyArray<{ readonly id: string }>) => running.map((r) => r.id);

test("lists the Turn's and its Subagents' running commands, not tools or streamed text", () => {
  const view = turn(
    [
      command("a", "running"),
      command("b", "completed"),
      tool("c"),
      { item: null, text: "x", output: "" },
    ],
    [command("d", "running")]
  );

  expect(ids(runningCommands(view, []))).toEqual(["a", "d"]);
});

test("adds background commands, once each, and leaves background Subagents out", () => {
  const view = turn([command("a", "running")]);

  expect(
    ids(
      runningCommands(view, [
        background("a", "command"),
        background("shell-1", "command"),
        background("s", "subagent"),
      ])
    )
  ).toEqual(["a", "shell-1"]);
  expect(runningCommands(undefined, [background("shell-1", "command")])).toEqual([
    { id: "shell-1", command: "shell-1" },
  ]);
});

test("one command names itself by its first line; more are counted; none says nothing", () => {
  expect(runningPhrase([])).toBeNull();
  expect(runningPhrase([{ id: "a", command: "bun test" }])).toBe("running bun test");
  expect(runningPhrase([{ id: "a", command: "  cat <<EOF\nhello\nEOF" }])).toBe(
    "running cat <<EOF"
  );
  expect(runningPhrase([{ id: "a", command: "" }])).toBe("1 command running");
  expect(
    runningPhrase([
      { id: "a", command: "bun test" },
      { id: "b", command: "sleep 40" },
    ])
  ).toBe("2 commands running");
});

test("a long command is clipped to 40 characters, so the strip's verb and time keep their room", () => {
  expect(
    runningPhrase([
      { id: "a", command: "bun test packages/client/src/userPath.test.ts apps/daemon/src/service" },
    ])
  ).toBe("running bun test packages/client/src/userPath.t…");
  expect(runningPhrase([{ id: "a", command: "x".repeat(40) }])).toBe(`running ${"x".repeat(40)}`);
});
