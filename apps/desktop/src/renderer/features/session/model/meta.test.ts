import { describe, expect, test } from "bun:test";
import { contextLabel, formatTokens, stepLabel, thoughtLabel } from "./meta.ts";

const at = (seconds: number) => new Date(Date.UTC(2026, 8, 30, 10, 0, seconds)).toISOString();

describe("thoughtLabel", () => {
  test("done and timed: how long it thought", () => {
    const done = { live: false, startedAt: at(0), endedAt: at(12) };
    expect(thoughtLabel(done, 0)).toEqual({ label: "Thought for 12s", elapsed: null });
    expect(thoughtLabel({ ...done, endedAt: at(0) }, 0).label).toBe("Thought for 1s");
    expect(thoughtLabel({ ...done, endedAt: at(80) }, 0).label).toBe("Thought for 1m 20s");
  });

  test("live: thinking, with the time so far when the start is known", () => {
    const live = { live: true, startedAt: at(0), endedAt: null };
    expect(thoughtLabel(live, Date.parse(at(4)))).toEqual({ label: "Thinking…", elapsed: "4s" });
    expect(thoughtLabel({ ...live, startedAt: null }, 0)).toEqual({
      label: "Thinking…",
      elapsed: null,
    });
  });

  test("untimed (older logs, Harnesses without times): just thought", () => {
    expect(thoughtLabel({ live: false, startedAt: null, endedAt: null }, 0).label).toBe("Thought");
    expect(thoughtLabel({ live: false, startedAt: at(0), endedAt: null }, 0).label).toBe("Thought");
  });
});

describe("stepLabel", () => {
  test("the current step says what it is doing now; the others their text", () => {
    const step = { text: "Run the tests", detail: "Running the tests" };
    expect(stepLabel({ ...step, status: "in-progress" })).toBe("Running the tests");
    expect(stepLabel({ ...step, status: "completed" })).toBe("Run the tests");
    expect(stepLabel({ ...step, status: "in-progress", detail: " " })).toBe("Run the tests");
    expect(stepLabel({ ...step, status: "in-progress", detail: null })).toBe("Run the tests");
  });
});

describe("contextLabel", () => {
  test("a share of the window, with the tokens for the tooltip", () => {
    expect(contextLabel({ usedTokens: 84_000, windowTokens: 200_000 })).toEqual({
      text: "Context 42%",
      detail: "84k of 200k tokens in context",
    });
  });

  test("near the limit the words change, never the colour", () => {
    expect(contextLabel({ usedTokens: 172_000, windowTokens: 200_000 })?.text).toBe(
      "Context 86% · nearly full"
    );
    expect(contextLabel({ usedTokens: 260_000, windowTokens: 200_000 })?.text).toBe(
      "Context 100% · nearly full"
    );
  });

  test("hidden until the Harness reports its window", () => {
    expect(contextLabel(null)).toBeNull();
    expect(contextLabel({ usedTokens: 5000, windowTokens: null })).toBeNull();
  });

  test("token counts read short", () => {
    expect([formatTokens(950), formatTokens(84_400), formatTokens(1_200_000)]).toEqual([
      "950",
      "84k",
      "1.2M",
    ]);
    expect(formatTokens(1_000_000)).toBe("1M");
  });
});
