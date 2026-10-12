import { describe, expect, test } from "bun:test";
import { TurnId, TurnItem } from "@polaris/protocol";
import { turnWith } from "../../../store/fixtures.testing.ts";
import type { TurnView } from "../../../store/sessionModel.ts";
import { conversationRows } from "./conversation.ts";
import { findInTranscript, occurrences } from "./search.ts";

const I = TurnItem.cases;

const view = (index: number, prompt: string, items: ReadonlyArray<TurnItem>): TurnView => ({
  turn: turnWith({ id: TurnId.make(`t${index}`), index, prompt, status: "completed" }),
  items,
  live: new Map(),
  subagents: [],
});

const turns = [
  view(0, "Fix the login form", [
    I.AssistantMessage.make({ id: "m0", text: "The form posts twice. Fixed the form handler." }),
    I.CommandExecution.make({
      id: "c0",
      command: "bun test form",
      cwd: "/r",
      output: "form form form",
      exitCode: 0,
      status: "completed",
    }),
  ]),
  view(1, "Now the signup FORM", [I.AssistantMessage.make({ id: "m1", text: "Done." })]),
];

describe("transcript search", () => {
  test("counts occurrences without overlap, by case when asked", () => {
    expect(occurrences("aaaa", "aa", { matchCase: false })).toBe(2);
    expect(occurrences("Form form", "form", { matchCase: true })).toBe(1);
    expect(occurrences("Form form", "form", { matchCase: false })).toBe(2);
    expect(occurrences("x", "", { matchCase: false })).toBe(0);
  });

  test("finds in folded Turns, in transcript order, one hit per occurrence", () => {
    const hits = findInTranscript(turns, "form", { matchCase: false });

    expect(hits.map((h) => `${h.rowKey}#${h.occurrence}`)).toEqual([
      "t0:prompt#0",
      "t0:m0#0",
      "t0:m0#1",
      "t0:c0#0",
      "t1:prompt#0",
    ]);
  });

  test("leaves command output out, and respects case", () => {
    expect(findInTranscript(turns, "FORM", { matchCase: true }).map((h) => h.rowKey)).toEqual([
      "t1:prompt",
    ]);
    expect(findInTranscript(turns, "   ", { matchCase: false })).toEqual([]);
  });

  test("a hit's row key is the row the conversation lists once its Turn is open", () => {
    const [hit] = findInTranscript(turns, "posts", { matchCase: false });

    const rows = conversationRows({
      turns,
      approvals: [],
      folds: { chosen: new Map([["t0", true]]), openFrom: null },
    });

    expect(rows.some((r) => r.key === hit?.rowKey)).toBe(true);
  });
});
