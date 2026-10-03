/**
 * The background scene: a Turn that started a bench and two background
 * Subagents, a Turn the Harness started itself when one reported, and the
 * session Idle, waiting on the rest. Two more sessions wait in the sidebar.
 */
import {
  BackgroundTask,
  type SessionId,
  type TurnId,
  TurnItem,
  TurnTrigger,
} from "@polaris/protocol";
import type { SessionModel, SubagentView } from "../../../store/sessionModel.ts";
import { agentCall, ago, model, read, session, subagentOf, turn, view } from "./fixtures.ts";

const I = TurnItem.cases;

const BENCH = "bun run bench sessions history --runs 3";

const REPORT = [
  "## Hot paths in the session store",
  "",
  "**Two folds dominate a 150-Turn replay:**",
  "",
  "- `upsertTurn` copies the whole `turns` array on every `TurnItemCompleted` (61% of fold time)",
  "- `patchSession` rebuilds the session's `Plain` view even when nothing changed",
  "",
  "Both are in `apps/desktop/src/renderer/store/sessionModel.ts`; neither needs a new data structure.",
].join("\n");

const explore = (s: SessionId, t: TurnId) =>
  subagentOf(
    s,
    t,
    "toolu_explore_store",
    "Find hot paths in the session store",
    "completed",
    [
      I.ToolCall.make({
        id: "e1",
        name: "Grep",
        input: { pattern: "upsertTurn" },
        output: null,
        status: "completed",
      }),
      read("e2", "apps/desktop/src/renderer/store/sessionModel.ts"),
      I.AssistantMessage.make({ id: "e3", text: "Now the fold helpers." }),
      read("e4", "apps/desktop/src/renderer/store/plain.ts"),
      I.ToolCall.make({
        id: "e5",
        name: "SubagentHandback",
        input: { message: REPORT },
        output: null,
        status: "completed",
      }),
    ],
    [],
    { background: true, report: REPORT }
  );

const tests = (s: SessionId, t: TurnId): SubagentView =>
  subagentOf(
    s,
    t,
    "toolu_store_tests",
    "Run the store tests under load",
    "working",
    [read("u1", "apps/desktop/src/renderer/store/sessionModel.test.ts")],
    [
      [
        "u2",
        {
          item: I.CommandExecution.make({
            id: "u2",
            command: "bun test apps/desktop/src/renderer/store --rerun-each 20",
            cwd: "/Users/lucas/code/polaris",
            output: "",
            exitCode: null,
            status: "running",
          }),
          text: "",
          output: "",
        },
      ],
    ],
    { background: true }
  );

const TASKS = [
  new BackgroundTask({
    id: "task-tests",
    kind: "subagent",
    description: "Run the store tests under load",
  }),
  new BackgroundTask({ id: "task-bench", kind: "command", description: BENCH }),
];

/** Turn 7 fanned out; Turn 8 is the Harness's own, after the explorer reported. */
export const background = (): SessionModel => {
  const s = session("s-background", {
    title: "Profile the session store",
    state: "idle",
    turnCount: 8,
    backgroundTasks: TASKS,
  });

  const fanned = turn(
    s.id,
    6,
    "Profile the session store: run the bench in the background and send agents after the hot paths.",
    "completed"
  );

  const woke = turn(s.id, 7, "[Background task continuation]", "completed", [], {
    trigger: TurnTrigger.cases.BackgroundTasksReported.make({
      tasks: [{ id: "task-explore", kind: "subagent" }],
    }),
    startedAt: ago(240),
    endedAt: ago(200),
  });

  return model({
    session: s,
    turns: [
      view(
        fanned,
        [
          I.AssistantMessage.make({
            id: "b1",
            text: "I'll start the bench and send two agents while it runs.",
          }),
          I.CommandExecution.make({
            id: "b2",
            command: BENCH,
            cwd: s.cwd,
            output: "Command running in background with ID: bench",
            exitCode: 0,
            status: "completed",
          }),
          agentCall(
            "toolu_explore_store",
            "Find hot paths in the session store",
            "Find the folds that dominate a long replay and report file and share of time.",
            true
          ),
          agentCall(
            "toolu_store_tests",
            "Run the store tests under load",
            "Run the store's tests 20 times and report flakes.",
            true
          ),
          I.AssistantMessage.make({
            id: "b3",
            text: "The bench and both agents are running. I'll pick up their reports as they land.",
          }),
        ],
        [],
        [explore(s.id, fanned.id), tests(s.id, fanned.id)]
      ),
      view(woke, [
        I.AssistantMessage.make({
          id: "w1",
          text: "The explorer found two hot paths: `upsertTurn` copies every Turn per item, and `patchSession` rebuilds unchanged sessions. I'll wait for the tests and the bench before changing either.",
        }),
      ]),
    ],
  });
};

const waitingOnly = (id: string, title: string, tasks: ReadonlyArray<BackgroundTask>) => () =>
  model({
    session: session(id, {
      title,
      state: "idle",
      turnCount: 3,
      backgroundTasks: tasks,
      createdAt: ago(5400),
    }),
  });

/** Sidebar-only sessions: two subagents, and a lone command. */
export const waitingSidebar = [
  waitingOnly("s-wait-agents", "Survey the Harness drivers", [
    new BackgroundTask({ id: "a1", kind: "subagent", description: "Read the Codex driver" }),
    new BackgroundTask({ id: "a2", kind: "subagent", description: "Read the OpenCode driver" }),
  ]),
  waitingOnly("s-wait-command", "Rebuild the site", [
    new BackgroundTask({ id: "c1", kind: "command", description: "bun run --cwd apps/site build" }),
  ]),
];
