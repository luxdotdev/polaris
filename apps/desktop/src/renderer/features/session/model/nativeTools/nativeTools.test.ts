import { describe, expect, test } from "bun:test";
import { SessionId, Subagent, SubagentId, TurnId, TurnItem } from "@polaris/protocol";
import { turnWith } from "../../../../store/fixtures.testing.ts";
import type { TurnView } from "../../../../store/sessionModel.ts";
import { conversationRows } from "../conversation.ts";
import { completedItemView, type ItemView, type ToolInput } from "../items.ts";
import { type Entry, groupItems, runSummary, toolLabel } from "../runs.ts";
import { NATIVE_TOOLS } from "./index.ts";

const I = TurnItem.cases;

const call = (id: string, name: string, input: ToolInput) =>
  I.ToolCall.make({ id, name, kind: "other", input, output: null, status: "completed" });

const view = (name: string, input: ToolInput) => completedItemView(call("x", name, input));

/** The items an entry shows: a run's calls, or the one item. */
const rowItems = (entry: Entry): ReadonlyArray<ItemView> => {
  if (entry.kind === "run") return entry.items;

  return entry.kind === "item" ? [entry.item] : [];
};

/** What a row shows: its verb and subject. */
const row = (item: ItemView) =>
  item.kind === "tool" ? `${toolLabel(item)} ${item.summary}`.trim() : "";

/** Each native tool: a sample input, its phrase in a run of one, and its row. */
const SAMPLES: ReadonlyArray<readonly [string, ToolInput, string, string]> = [
  [
    "SendMessage",
    { to: "aa156f52", summary: "Rebase on main", message: "Rebase on main, then\nrun tests" },
    "Messaged a subagent",
    "Messaged aa156f52 · Rebase on main",
  ],
  ["ListAgents", {}, "Listed agents", "Listed agents"],
  ["TaskStop", { task_id: "b7x2" }, "Stopped a task", "Stopped a task b7x2"],
  ["KillShell", { shell_id: "s1" }, "Stopped a task", "Stopped a task s1"],
  [
    "TaskOutput",
    { task_id: "b7x2" },
    "Checked a background task",
    "Checked a background task b7x2",
  ],
  ["BashOutput", { bash_id: "b1" }, "Checked a background task", "Checked a background task b1"],
  [
    "TodoWrite",
    { todos: [{ content: "a" }, { content: "b" }] },
    "Updated the todo list",
    "Updated the todo list 2 todos",
  ],
  [
    "AskUserQuestion",
    { questions: [{ question: "Which branch?", options: [] }] },
    "Asked you a question",
    "Asked you Which branch?",
  ],
  ["EnterPlanMode", {}, "Entered plan mode", "Entered plan mode"],
  [
    "ExitPlanMode",
    { plan: "# Move the store\n\nSteps…" },
    "Proposed a plan",
    "Proposed a plan Move the store",
  ],
  ["EnterWorktree", { name: "eng-537" }, "Entered a worktree", "Entered a worktree eng-537"],
  ["ExitWorktree", { action: "remove" }, "Left the worktree", "Left the worktree removed"],
  [
    "CronCreate",
    { cron: "0 9 * * 1", prompt: "Check the release\nthen report" },
    "Scheduled a prompt",
    "Scheduled a prompt 0 9 * * 1 · Check the release",
  ],
  ["CronDelete", { id: "c1" }, "Deleted a schedule", "Deleted a schedule"],
  ["CronList", {}, "Listed schedules", "Listed schedules"],
  [
    "ScheduleWakeup",
    { delaySeconds: 300, reason: "CI takes five minutes" },
    "Scheduled a wakeup",
    "Scheduled a wakeup CI takes five minutes",
  ],
  [
    "Monitor",
    { description: "Watch the build", timeout_ms: 1000 },
    "Started a monitor",
    "Started a monitor Watch the build",
  ],
  [
    "LSP",
    { operation: "goToDefinition", filePath: "src/a.ts", line: 3, character: 1 },
    "Queried the language server",
    "Queried the language server gotodefinition · src/a.ts",
  ],
  [
    "TaskCreate",
    { subject: "Write tests", description: "…" },
    "Added a todo",
    "Added a todo Write tests",
  ],
  [
    "TaskUpdate",
    { taskId: "1", status: "in_progress" },
    "Updated a todo",
    "Updated a todo in progress",
  ],
  ["TaskGet", { taskId: "1" }, "Read a todo", "Read a todo"],
  ["TaskList", {}, "Listed todos", "Listed todos"],
  [
    "ListMcpResourcesTool",
    { server: "claude_ai_Linear" },
    "Listed MCP resources",
    "Listed MCP resources Linear",
  ],
  [
    "ReadMcpResourceTool",
    { server: "paper", uri: "paper://file/1" },
    "Read an MCP resource",
    "Read an MCP resource Paper · paper://file/1",
  ],
  [
    "Workflow",
    { title: "Nightly audit" },
    "Started a workflow",
    "Started a workflow Nightly audit",
  ],
  [
    "RemoteTrigger",
    { action: "list_runs" },
    "Used remote triggers",
    "Used remote triggers list runs",
  ],
  [
    "PushNotification",
    { message: "Build is green", status: "proactive" },
    "Sent a notification",
    "Sent a notification Build is green",
  ],
  [
    "SendFeedback",
    { type: "bug", title: "Crash on open", details: "…" },
    "Sent feedback",
    "Sent feedback Crash on open",
  ],
  [
    "ReportFindings",
    { findings: [{}, {}, {}] },
    "Reported findings",
    "Reported findings 3 findings",
  ],
  [
    "ProposeGoal",
    { condition: "All tests pass" },
    "Proposed a goal",
    "Proposed a goal All tests pass",
  ],
  ["ProposeSkills", { proposals: [{}] }, "Proposed skills", "Proposed skills 1 skill"],
  [
    "Artifact",
    { action: "publish", title: "Release notes" },
    "Worked on an artifact",
    "Worked on an artifact Release notes",
  ],
  ["ReadNotifications", {}, "Read notifications", "Read notifications"],
  [
    "Projects",
    { method: "read_file", path: "notes.md" },
    "Used projects",
    "Used projects read file · notes.md",
  ],
  [
    "ClaudeDesign",
    { operation: "export_frame", arguments: {} },
    "Used Claude Design",
    "Used Claude Design export frame",
  ],
  ["ShowOnboardingRolePicker", {}, "Showed the role picker", "Showed the role picker"],
];

/** Tools that keep their own row: a call that spawns a Subagent becomes its card. */
const OWN_ROW: ReadonlyArray<readonly [string, ToolInput, string]> = [
  [
    "Agent",
    { description: "Explore the store", prompt: "…" },
    "Started a subagent Explore the store",
  ],
  [
    "Task",
    { description: "Explore the store", prompt: "…" },
    "Started a subagent Explore the store",
  ],
];

describe("Claude Code's own tools", () => {
  test("every registered tool has a sample", () => {
    expect([...SAMPLES.map(([name]) => name), ...OWN_ROW.map(([name]) => name)].sort()).toEqual(
      [...NATIVE_TOOLS].sort()
    );
  });

  test.each(SAMPLES)("%s reads as a phrase and a row, never JSON", (name, input, phrase, shown) => {
    const item = view(name, input);

    expect(runSummary([item])).toBe(phrase);
    expect(row(item)).toBe(shown);
    expect(row(item)).not.toMatch(/[{}"]/);
  });

  test.each(OWN_ROW)("%s keeps its own row, in words", (name, input, shown) => {
    const item = view(name, input);

    expect(groupItems([item, item]).map((e) => e.kind)).toEqual(["item", "item"]);
    expect(row(item)).toBe(shown);
  });

  test.each([
    ["SendMessage", { summary: "no recipient" }],
    ["TaskStop", "not an object"],
    ["CronCreate", { cron: 5 }],
    ["SomeNewTool", { anything: true }],
  ] as const)("%s with input it can't read keeps the generic row", (name, input) => {
    const item = view(name, input);

    expect(item.kind === "tool" ? item.native : "not a tool").toBeNull();
    expect(row(item).startsWith(`${name} `)).toBe(true);
    expect(groupItems([item, item]).map((e) => e.kind)).toEqual(["item", "item"]);
  });

  test("a run with two messages and a command adds them to the summary", () => {
    const send = (id: string, to: string) =>
      completedItemView(call(id, "SendMessage", { to, summary: "keep going" }));

    const bash = completedItemView(
      I.CommandExecution.make({
        id: "c1",
        command: "bun test",
        cwd: "/r",
        output: "",
        exitCode: 0,
        status: "completed",
      })
    );

    const linear = completedItemView(
      I.ToolCall.make({
        id: "l1",
        name: "mcp__claude_ai_Linear__get_issue",
        kind: "mcp",
        mcp: { server: "claude_ai_Linear", tool: "get_issue" },
        input: {},
        output: null,
        status: "completed",
      })
    );

    expect(groupItems([send("m1", "a1"), bash, linear, send("m2", "a2")])).toEqual([
      expect.objectContaining({
        kind: "run",
        summary: "Ran 1 command, called Linear once, messaged 2 subagents",
      }),
    ]);
  });

  test("ToolSearch reads as the tools it loaded by name", () => {
    const search = view("ToolSearch", { query: "select:Monitor,TaskStop,SendMessage" });

    expect(runSummary([search, view("ListAgents", {})])).toBe("Loaded 3 tools, listed agents");
  });
});

describe("a message to a Subagent", () => {
  const agentCall = I.ToolCall.make({
    id: "toolu_agent",
    name: "Agent",
    input: { description: "Rebase the branch", prompt: "…", name: "rebaser" },
    output: { status: "async_launched", agentId: "a157d0bd681b8ae6e" },
    status: "completed",
  });

  const subagent = new Subagent({
    id: SubagentId.make("toolu_agent"),
    sessionId: SessionId.make("s1"),
    turnId: TurnId.make("t0"),
    parentItemId: "toolu_agent",
    title: "Rebase the branch",
    agent: "general-purpose",
    model: null,
    status: "completed",
    startedAt: "2026-10-01T00:00:00.000Z",
    endedAt: "2026-10-01T00:00:05.000Z",
  });

  const turn = (index: number, items: ReadonlyArray<TurnItem>): TurnView => ({
    turn: turnWith({ id: TurnId.make(`t${index}`), index, prompt: `prompt ${index}` }),
    items,
    live: new Map(),
    subagents: [],
  });

  const spawned: TurnView = {
    ...turn(0, [agentCall]),
    subagents: [{ subagent, items: [], live: new Map() }],
  };

  /** The rows a later Turn's SendMessage calls show, by call id. */
  const shown = (inputs: ReadonlyArray<ToolInput>) => {
    const later = turn(
      1,
      inputs.map((input, n) => call(`m${n}`, "SendMessage", input))
    );

    return conversationRows({
      turns: [spawned, later],
      approvals: [],
      folds: {
        chosen: new Map([
          ["t0", true],
          ["t1", true],
        ]),
        openFrom: null,
      },
    }).flatMap((r) => {
      if (r.kind !== "item") return [];

      return rowItems(r.entry)
        .map(row)
        .filter((text) => text.startsWith("Messaged"));
    });
  };

  test.each([
    ["its agent id", "a157d0bd681b8ae6e"],
    ["its name", "rebaser"],
  ])("addressed by %s reads the Subagent's title", (_, to) => {
    expect(shown([{ to, summary: "Rebase on main" }])).toEqual([
      "Messaged Rebase the branch · Rebase on main",
    ]);
  });

  test("an unknown recipient reads as addressed; a message without summary shows its first line", () => {
    expect(
      shown([
        { to: "zz99", message: "Stop now\nand report" },
        { to: "rebaser", summary: "Go" },
      ])
    ).toEqual(["Messaged zz99 · Stop now", "Messaged Rebase the branch · Go"]);
  });
});
