import { describe, expect, test } from "bun:test";
import { TurnItem } from "@polaris/protocol";
import { applySessionItem, type SessionFold } from "./fold.ts";
import { newestEndedOnScreen, threadRows, type ThreadRow } from "./rows.ts";
import { snapshot, turn } from "./daemon.testing.ts";
import { SessionStreamItem, TurnId } from "@polaris/protocol";

const edit = (id: string, path: string, status: "running" | "completed" = "completed") =>
  TurnItem.cases.FileChange.make({ id, changes: [{ path, kind: "modify" }], status });

const reply = (id: string, text: string) => TurnItem.cases.AssistantMessage.make({ id, text });

const read = (id: string, title: string) =>
  TurnItem.cases.ToolCall.make({
    id,
    name: "Read",
    title,
    input: {},
    output: null,
    status: "completed",
  });

/** A row as a line: steps with their index, active mark and group end ("|"). */
const line = (row: ThreadRow): string => {
  switch (row.kind) {
    case "step":
      return `${row.index} ${row.label}${row.tone === "active" ? " (active)" : ""}${row.last ? " |" : ""}`;
    case "earlier":
      return `Turn ${row.number}: ${row.title}`;
    default:
      return `${row.kind}: ${row.text}`;
  }
};

const foldOf = (items: ReadonlyArray<SessionStreamItem>) =>
  items.reduce<SessionFold | null>(applySessionItem, null);

describe("thread rows", () => {
  test("earlier Turns collapse to one row each; the latest shows its prompt, replies and numbered steps", () => {
    const fold = foldOf([
      snapshot([
        {
          turn: turn(0, { replyPreview: "Recorded the Review decision" }),
          items: [reply("a", "done")],
        },
        {
          turn: turn(1, { prompt: "Prototype the layouts", status: "working", endedAt: null }),
          items: [
            reply("b", "I'll build four variants."),
            read("c", "Read the Orchestrator notes"),
            edit("d", "src/index.html"),
            edit("e", "src/serve.ts", "running"),
            reply("f", "Variant 3 is the dense table."),
          ],
        },
      ]),
    ]);

    const rows = threadRows(fold?.turns ?? [], new Set());

    expect(rows.map(line)).toEqual([
      "Turn 1: Recorded the Review decision",
      "prompt: Prototype the layouts",
      "reply: I'll build four variants.",
      "01 Read the Orchestrator notes",
      "02 Edited index.html",
      "03 Writing serve.ts (active) |",
      "reply: Variant 3 is the dense table.",
    ]);
  });

  test("an opened earlier Turn shows its rows under its header", () => {
    const fold = foldOf([
      snapshot([{ turn: turn(0), items: [reply("a", "first reply")] }, { turn: turn(1) }]),
    ]);

    const rows = threadRows(fold?.turns ?? [], new Set([TurnId.make("t-0")]));

    expect(rows.slice(0, 3).map((row) => row.kind)).toEqual(["earlier", "prompt", "reply"]);
  });

  test("a long transcript stays one row per earlier Turn, and streaming rebuilds only the latest", () => {
    const turns = Array.from({ length: 1000 }, (_, index) => ({
      turn: turn(index, { status: index === 999 ? "working" : "completed" }),
      items: Array.from({ length: 30 }, (_, n) => edit(`i${index}-${n}`, `f${n}.ts`)),
    }));

    const before = foldOf([snapshot(turns)]);
    const rowsBefore = threadRows(before?.turns ?? [], new Set());

    // 999 collapsed Turns, then the latest's prompt and 30 steps.
    expect(rowsBefore.length).toBe(999 + 1 + 30);

    const after = applySessionItem(
      before,
      SessionStreamItem.cases.Delta.make({
        turnId: TurnId.make("t-999"),
        itemId: "live",
        field: "text",
        text: "Still going",
        subagentId: null,
      })
    );

    const rowsAfter = threadRows(after?.turns ?? [], new Set());

    expect(rowsAfter.at(-1)).toMatchObject({ kind: "reply", text: "Still going" });
    expect(rowsAfter[0]).toBe(rowsBefore[0]);
    expect(rowsAfter[998]).toBe(rowsBefore[998]);
  });
});

describe("read position", () => {
  test("the newest ended Turn on screen, never a working one", () => {
    const fold = foldOf([
      snapshot([
        { turn: turn(0) },
        { turn: turn(1) },
        { turn: turn(2, { status: "working", endedAt: null }) },
      ]),
    ]);

    expect(newestEndedOnScreen(fold?.turns ?? [], ["t-0", "t-1", "t-2"])?.turn.index).toBe(1);
    expect(newestEndedOnScreen(fold?.turns ?? [], ["t-2"])).toBeNull();
  });
});
