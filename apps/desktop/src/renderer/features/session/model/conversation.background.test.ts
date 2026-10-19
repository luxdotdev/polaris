import { describe, expect, test } from "bun:test";
import {
  BackgroundTask,
  Sequence,
  TurnDetail,
  TurnId,
  TurnItem,
  TurnPage,
  TurnTrigger,
} from "@polaris/protocol";
import { approval, turnWith } from "../../../store/fixtures.testing.ts";
import { emptySessionModel, type TurnView, withOlderTurns } from "../../../store/sessionModel.ts";
import { conversationRows, type Folds, type Row, summarize, turnStartRow } from "./conversation.ts";
import { railTurns } from "./rail.ts";
import { findInTranscript } from "./search.ts";
import { continuesOlder, copyableOutput, groupTurns, turnNumber } from "./turnGroups.ts";

const I = TurnItem.cases;

const reply = (id: string, text: string) => I.AssistantMessage.make({ id, text });

const edit = (id: string, path: string) =>
  I.FileChange.make({ id, changes: [{ path, kind: "modify" }], status: "completed" });

const prompted = (
  index: number,
  items: ReadonlyArray<TurnItem> = [],
  status: "working" | "completed" = "completed"
): TurnView => ({
  turn: turnWith({ id: TurnId.make(`t${index}`), index, prompt: `prompt ${index}`, status }),
  items,
  live: new Map(),
  subagents: [],
});

const continuation = (
  index: number,
  items: ReadonlyArray<TurnItem> = [],
  status: "working" | "completed" = "completed"
): TurnView => ({
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
    status,
  }),
  items,
  live: new Map(),
  subagents: [],
});

const kinds = (rows: ReadonlyArray<Row>) => rows.map((r) => r.kind);

const allOpen = (turns: ReadonlyArray<TurnView>): Folds => ({
  chosen: new Map(),
  openFrom: turns[0]?.turn.id ?? null,
});

describe("a Turn the Harness started folds into the Turn before it", () => {
  // t0 user, t1 and t2 Harness-started, t3 user, t4 Harness-started.
  const session = [
    prompted(0, [reply("m0", "Fanned out"), edit("f0", "a.ts")]),
    continuation(1, [reply("m1", "First report in"), edit("f1", "b.ts")]),
    continuation(2, [reply("m2", "Both in")]),
    prompted(3, [reply("m3", "Done")]),
    continuation(4, [reply("m4", "Bench finished")]),
  ];

  test("one shown Turn per user message, numbered in order", () => {
    const groups = groupTurns(session);

    expect(groups.map((g) => `${g.id} #${g.number} ×${g.views.length}`)).toEqual([
      "t0 #1 ×3",
      "t3 #2 ×2",
    ]);
    expect(turnNumber(session, "t2")).toBe(1);
    expect(turnNumber(session, "t4")).toBe(2);
  });

  test("open, a Harness-started Turn is a quiet line inside the Turn, with no Turn of its own", () => {
    const rows = conversationRows({ turns: session, approvals: [], folds: allOpen(session) });

    expect(kinds(rows).filter((k) => k === "prompt" || k === "summary")).toEqual([
      "prompt",
      "prompt",
    ]);

    const triggers = rows.filter((r) => r.kind === "trigger");

    expect(triggers.map((r) => [r.turnId, r.text, r.opensTurn])).toEqual([
      ["t0", "2 subagents reported", false],
      ["t0", "2 subagents reported", false],
      ["t3", "2 subagents reported", false],
    ]);
    expect(JSON.stringify(rows)).not.toContain("[Background task continuation]");
    expect(turnStartRow(rows, "t0")).toBe(0);
    expect(turnStartRow(rows, "t1")).toBe(-1);
  });

  test("folded, the Turn is one summary covering every Turn in it", () => {
    const rows = conversationRows({ turns: session, approvals: [] });

    expect(kinds(rows)).toEqual(["summary", "prompt", "item", "trigger", "item"]);
    expect(rows[0]).toMatchObject({
      turnId: "t0",
      lastTurnId: "t2",
      number: 1,
      summary: "Both in",
      files: 2,
    });
  });

  test("the user's fold of a Turn folds the Turns the Harness started in it", () => {
    const rows = conversationRows({
      turns: session,
      approvals: [],
      folds: { chosen: new Map([["t3", false]]), openFrom: "t0" },
    });

    const folded = rows.findIndex((r) => r.kind === "summary" && r.turnId === "t3");

    expect(kinds(rows.slice(folded))).toEqual(["summary"]);
  });

  test("a Turn the Harness starts never folds the Turn being read, and stays the latest", () => {
    const shown = [prompted(0, [reply("m0", "Fanned out")])];
    const folds: Folds = { chosen: new Map(), openFrom: "t0" };
    const later = [...shown, continuation(1, [reply("m1", "In")], "working")];
    const rows = conversationRows({ turns: later, approvals: [], folds });

    expect(kinds(rows)).toEqual(["prompt", "item", "trigger", "item"]);
    expect(rows.filter((r) => r.kind === "item").map((r) => r.latest)).toEqual([true, true]);
    expect(rows[0]).toMatchObject({ kind: "prompt", number: 1 });
  });

  test("an approval a Harness-started Turn asks for follows the whole Turn it is in", () => {
    // The fixture approval was asked in t1, the first Harness-started Turn.
    const rows = conversationRows({
      turns: session,
      approvals: [approval],
      folds: allOpen(session),
    });

    const at = rows.findIndex((r) => r.kind === "approval");

    expect(rows[at - 1]).toMatchObject({ kind: "item", partId: "t2" });
    expect(rows[at + 1]).toMatchObject({ kind: "prompt", turnId: "t3" });
  });
});

describe("a Harness-started Turn with no Turn before it", () => {
  const session = [continuation(0, [reply("m0", "Picked up")]), prompted(1)];

  test("stays a Turn of its own, with the fold control", () => {
    expect(groupTurns(session).map((g) => `${g.id} #${g.number}`)).toEqual(["t0 #1", "t1 #2"]);

    const rows = conversationRows({ turns: session, approvals: [], folds: allOpen(session) });

    expect(rows[0]).toMatchObject({ kind: "trigger", turnId: "t0", opensTurn: true, number: 1 });
    expect(turnStartRow(rows, "t0")).toBe(0);
  });

  test("folded, it summarizes as its last reply, else what woke it", () => {
    const [alone] = groupTurns([continuation(0)]);
    const [replied] = groupTurns(session);

    expect(alone === undefined ? null : summarize(alone).summary).toBe("2 subagents reported");
    expect(replied === undefined ? null : summarize(replied).summary).toBe("Picked up");
  });
});

describe("consumers see the shown Turns", () => {
  const session = [
    prompted(0, [reply("m0", "Started"), edit("f0", "a.ts")]),
    continuation(1, [reply("m1", "needle in a report"), edit("f1", "b.ts")]),
    prompted(2, [reply("m2", "ok")]),
    prompted(3, [reply("m3", "ok")]),
  ];

  test("the rail has one tick per user Turn, its preview counting files across the Turn", () => {
    expect(railTurns(session).map((t) => [t.turnId, t.number, t.files, t.opening])).toEqual([
      ["t0", 1, 2, "prompt 0"],
      ["t2", 2, 0, "prompt 2"],
      ["t3", 3, 0, "prompt 3"],
    ]);
  });

  test("a match in a Harness-started Turn names the Turn it is in, so stepping there opens it", () => {
    expect(findInTranscript(session, "needle", { matchCase: false })).toEqual([
      { turnId: "t0", rowKey: "t1:m1", occurrence: 0 },
    ]);
  });

  test("Copy turn output has every reply across the Turn", () => {
    const [first] = groupTurns(session);

    expect(first === undefined ? null : copyableOutput(first, "Started", false)).toBe(
      "Started\n\nneedle in a report"
    );
    expect(first === undefined ? null : copyableOutput(first, "Started", true)).toBeNull();
  });
});

describe("older pages", () => {
  const page = (views: ReadonlyArray<TurnView>) =>
    new TurnPage({
      turns: views.map((v) => new TurnDetail({ turn: v.turn, items: v.items, subagents: [] })),
      sequence: Sequence.make(1),
      hasMore: false,
    });

  test("a page that begins inside a Turn asks for the one before, then groups and numbers it", () => {
    const listed = [continuation(20), continuation(21), prompted(22)];

    expect(continuesOlder(listed)).toBe(true);
    expect(continuesOlder([continuation(0)])).toBe(false);
    expect(continuesOlder([prompted(22)])).toBe(false);

    const model = withOlderTurns(
      { ...emptySessionModel, turns: listed },
      page([prompted(18), prompted(19)])
    );

    expect(continuesOlder(model.turns)).toBe(false);
    expect(groupTurns(model.turns).map((g) => `${g.id} #${g.number} ×${g.views.length}`)).toEqual([
      "t18 #19 ×1",
      "t19 #20 ×3",
      "t22 #21 ×1",
    ]);
  });
});

test("background tasks an Idle session waits on close the list, before outgoing rows", () => {
  const tasks = [new BackgroundTask({ id: "x", kind: "command", description: "bun run bench" })];
  const rows = conversationRows({ turns: [prompted(0)], approvals: [], waiting: tasks });

  expect(rows.at(-1)).toEqual({ kind: "waiting", key: "waiting", tasks });
});
