import { describe, expect, test } from "bun:test";
import {
  type DomainEvent,
  DomainEvent as Events,
  SessionStreamItem,
  Subagent,
  SubagentId,
  TurnItem,
} from "@polaris/protocol";
import {
  approval,
  envelope,
  seq,
  session,
  turn,
  turnId,
  turnWith,
} from "../../../store/fixtures.testing.ts";
import {
  applySessionItems,
  emptySessionModel,
  type SessionModel,
} from "../../../store/sessionModel.ts";
import { notices, type NoticeInput, stripLayout } from "./notices.ts";
import { todoList } from "./todoList.ts";

const S = SessionStreamItem.cases;

const E = Events.cases;

const event = (sequence: number, e: DomainEvent) =>
  S.Event.make({ envelope: envelope(sequence, e) });

type Status = "pending" | "in-progress" | "completed";

/** A TodoWrite as the Claude Code driver sends it: `activeForm` is the step's detail. */
const todoWrite = (todos: ReadonlyArray<readonly [string, Status, string?]>) =>
  TurnItem.cases.Plan.make({
    id: `plan:${turnId}`,
    steps: todos.map(([text, status, detail]) => ({ text, status, detail: detail ?? null })),
    explanation: null,
  });

const working = applySessionItems(emptySessionModel, [
  S.Snapshot.make({ sequence: seq(2), session, turns: [], pendingApprovals: [] }),
  S.Synchronized.make({ sequence: seq(2) }),
  event(3, E.TurnStarted.make({ turn })),
]);

const progress = (model: SessionModel, item: TurnItem, subagentId: SubagentId | null = null) =>
  applySessionItems(model, [S.ItemProgress.make({ turnId, item, subagentId })]);

const listOf = (model: SessionModel) => todoList(model.turns.at(-1));

const FIRST = todoWrite([
  ["Read the notice strip", "completed"],
  ["Add the todo notice", "completed"],
  ["Write the tests", "in-progress", "Writing the tests"],
  ["Run the checks", "pending"],
  ["Take screenshots", "pending"],
  ["Rebase on main", "pending"],
  ["Report back", "pending"],
]);

describe("the todo list in the notice strip", () => {
  test("reads the Turn's latest TodoWrite: the item in progress, by its activeForm, and 3 of 7", () => {
    const list = listOf(progress(working, FIRST));

    expect(list?.label).toBe("Writing the tests");
    expect(list?.current).toBe(2);
    expect(list?.steps).toHaveLength(7);
    expect(list?.done).toBe(2);
  });

  test("follows the agent as it rewrites the list", () => {
    const rewritten = progress(
      progress(working, FIRST),
      todoWrite([
        ["Read the notice strip", "completed"],
        ["Write the tests", "completed"],
        ["Run the checks", "in-progress", "Running the checks"],
      ])
    );

    const list = listOf(rewritten);

    expect(list?.label).toBe("Running the checks");
    expect([list?.current, list?.steps.length, list?.done]).toEqual([2, 3, 2]);
  });

  test("with nothing in progress, reads the next item not done", () => {
    const list = listOf(
      progress(
        working,
        todoWrite([
          ["Write the tests", "completed", "Writing the tests"],
          ["Run the checks", "pending", "Running the checks"],
        ])
      )
    );

    expect([list?.label, list?.current]).toEqual(["Run the checks", 1]);
  });

  test("folds away once every item is done", () => {
    const done = todoWrite([
      ["Write the tests", "completed"],
      ["Run the checks", "completed"],
    ]);

    expect(listOf(progress(working, done))).toBeNull();
  });

  test("folds away when the Turn ends, though the plan stays in the conversation", () => {
    const ended = applySessionItems(progress(working, FIRST), [
      event(
        4,
        E.TurnItemCompleted.make({ sessionId: session.id, turnId, item: FIRST, subagentId: null })
      ),
      event(
        5,
        E.TurnEnded.make({ turn: turnWith({ status: "interrupted", endedAt: turn.startedAt }) })
      ),
    ]);

    expect(ended.turns[0]?.items).toContainEqual(FIRST);
    expect(listOf(ended)).toBeNull();
  });

  test("leaves a Subagent's own list out", () => {
    const subagentId = SubagentId.make("sa1");

    const withSubagent = applySessionItems(working, [
      event(
        4,
        E.SubagentStarted.make({
          subagent: new Subagent({
            id: subagentId,
            sessionId: session.id,
            turnId,
            parentItemId: null,
            title: "Look around",
            agent: "Explore",
            model: null,
            status: "working",
            startedAt: turn.startedAt,
            endedAt: null,
          }),
        })
      ),
    ]);

    expect(listOf(progress(withSubagent, FIRST, subagentId))).toBeNull();
  });

  test("reads Codex's plan updates the same way", () => {
    const codex = TurnItem.cases.Plan.make({
      id: `${turnId}:plan`,
      steps: [
        { text: "Map the protocol", status: "completed", detail: null },
        { text: "Wire the driver", status: "in-progress", detail: null },
        { text: "Test it", status: "pending", detail: null },
      ],
      explanation: "Driver first, so the tests have something to run.",
    });

    const list = listOf(progress(working, codex));

    expect([list?.label, list?.current, list?.done]).toEqual(["Wire the driver", 1, 1]);
  });
});

const quiet: NoticeInput = {
  approvals: [],
  working: false,
  todo: null,
  outbox: [],
  contextShare: null,
  contextDismissedAt: null,
  limited: false,
  resetsAt: null,
};

describe("the todo list's place in the strip", () => {
  const todo = listOf(progress(working, FIRST));

  test("shares the strip with Working, nothing behind +n", () => {
    const layout = stripLayout(notices({ ...quiet, working: true, todo }));

    expect(layout.shown.map((n) => n.kind)).toEqual(["working", "todo"]);
    expect(layout.behind).toEqual([]);
  });

  test("an approval outranks it", () => {
    const layout = stripLayout(notices({ ...quiet, approvals: [approval], todo }));

    expect(layout.shown.map((n) => n.kind)).toEqual(["approval"]);
    expect(layout.behind.map((n) => n.kind)).toEqual(["todo"]);
  });
});
