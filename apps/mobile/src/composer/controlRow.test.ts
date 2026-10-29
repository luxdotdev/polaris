import { describe, expect, test } from "bun:test";
import { ContextUsage, SessionId, Subagent, SubagentId, TurnId } from "@polaris/protocol";
import { contextRing, litSegments, moonsOf } from "./controlRow.ts";

const helper = (id: string, status: Subagent["status"]) =>
  new Subagent({
    id: SubagentId.make(id),
    sessionId: SessionId.make("s-1"),
    turnId: TurnId.make("t-1"),
    parentItemId: null,
    title: id,
    agent: null,
    model: null,
    status,
    startedAt: "2026-10-29T12:00:00.000Z",
    endedAt: null,
  });

const usage = (usedTokens: number, windowTokens: number | null) =>
  new ContextUsage({ usedTokens, windowTokens });

describe("subagent moons", () => {
  test("only working Subagents count, at most three moons, each keeping its place", () => {
    const moons = moonsOf([
      helper("a", "completed"),
      helper("b", "working"),
      helper("c", "working"),
      helper("d", "failed"),
      helper("e", "working"),
      helper("f", "working"),
    ]);

    expect(moons.running).toBe(4);
    expect(moons.moons).toEqual([
      { id: "b", index: 1 },
      { id: "c", index: 2 },
      { id: "e", index: 4 },
    ]);
  });
});

describe("context ring", () => {
  test.each<[string, ContextUsage | null, { share: number; words: string; nearlyFull: boolean }]>([
    ["before any report: empty, never 0%", null, { share: 0, words: "—", nearlyFull: false }],
    [
      "window unknown: the tokens",
      usage(84_200, null),
      { share: 0, words: "84k", nearlyFull: false },
    ],
    [
      "a share of the window",
      usage(34_000, 200_000),
      { share: 0.17, words: "17%", nearlyFull: false },
    ],
    ["nearly full", usage(180_000, 200_000), { share: 0.9, words: "90%", nearlyFull: true }],
    [
      "past the window stays full",
      usage(250_000, 200_000),
      { share: 1, words: "100%", nearlyFull: true },
    ],
  ])("%s", (_, given, expected) => {
    expect(contextRing(given)).toEqual(expected);
  });

  test("any use lights a segment; none lights none", () => {
    expect([litSegments(0), litSegments(0.001), litSegments(0.17), litSegments(1)]).toEqual([
      0, 1, 3, 20,
    ]);
  });
});
