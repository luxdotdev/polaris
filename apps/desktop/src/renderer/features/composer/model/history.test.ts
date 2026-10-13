import { describe, expect, test } from "bun:test";
import { TurnItem } from "@polaris/protocol";
import {
  AT_DRAFT,
  type HistoryCursor,
  type SentTurn,
  sentMessages,
  stepHistory,
} from "./history.ts";

const turn = (id: string, prompt: string, extra: Partial<SentTurn> = {}): SentTurn => ({
  id,
  prompt,
  notTyped: false,
  items: [],
  ...extra,
});

const steer = (text: string) => TurnItem.cases.UserMessage.make({ id: text, text });

describe("what the user sent", () => {
  test("prompts and their steers, oldest first", () => {
    const turns = [
      turn("t1", "fix the flaky test", {
        items: [
          TurnItem.cases.AssistantMessage.make({ id: "a", text: "on it" }),
          steer("only the unit ones"),
        ],
      }),
      turn("t2", "now the docs"),
    ];

    expect(sentMessages(turns, () => false)).toEqual([
      "fix the flaky test",
      "only the unit ones",
      "now the docs",
    ]);
  });

  test("skips Turns nobody typed, keeping steers sent into them, and blanks and repeats", () => {
    const turns = [
      turn("t1", "Background work reported", { notTyped: true }),
      turn("t2", "digest: B2 finished", { items: [steer("ship it")] }),
      turn("t3", "   "),
      turn("t4", "again"),
      turn("t5", "again"),
    ];

    expect(sentMessages(turns, (id, item) => id === "t2" && item === null)).toEqual([
      "ship it",
      "again",
    ]);
  });

  test("skips steers Polaris wrote (a steered digest)", () => {
    const turns = [
      turn("t1", "fix it", { items: [steer("digest: B2 finished"), steer("and lint")] }),
    ];

    expect(sentMessages(turns, (_, item) => item === "digest: B2 finished")).toEqual([
      "fix it",
      "and lint",
    ]);
  });
});

describe("↑ and ↓", () => {
  const entries = ["one", "two", "three"];

  const walk = (keys: ReadonlyArray<1 | -1>, draft = "half typed") => {
    let cursor: HistoryCursor = AT_DRAFT;
    let text = draft;
    const shown: Array<string | null> = [];

    for (const by of keys) {
      const step = stepHistory(entries, cursor, by, text);

      shown.push(step?.text ?? null);

      if (step === null) continue;
      cursor = step.cursor;
      text = step.text;
    }

    return { shown, cursor };
  };

  test("↑ walks back from the newest and stops at the oldest", () => {
    expect(walk([-1, -1, -1, -1]).shown).toEqual(["three", "two", "one", null]);
  });

  test("↓ walks forward and puts the unsent draft back past the newest", () => {
    const { shown, cursor } = walk([-1, -1, 1, 1, 1]);

    expect(shown).toEqual(["three", "two", "three", "half typed", null]);
    expect(cursor).toEqual(AT_DRAFT);
  });

  test("↓ in the draft and ↑ with nothing sent do nothing", () => {
    expect(walk([1]).shown).toEqual([null]);
    expect(stepHistory([], AT_DRAFT, -1, "x")).toBeNull();
  });
});
