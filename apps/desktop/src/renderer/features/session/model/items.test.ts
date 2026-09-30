import { describe, expect, test } from "bun:test";
import { TurnItem } from "@polaris/protocol";
import { completedItemView, liveItemView } from "./items.ts";

const startedAt = "2026-09-30T10:00:00.000Z";

describe("item views", () => {
  test("live thinking is reasoning with its start, its text streamed", () => {
    const item = TurnItem.cases.Reasoning.make({ id: "r", text: "", startedAt, endedAt: null });

    expect(liveItemView("r", { item, text: "Hmm", output: "" })).toEqual({
      kind: "reasoning",
      id: "r",
      live: true,
      text: "Hmm",
      startedAt,
      endedAt: null,
    });
  });

  test("a plan keeps each step's detail and its explanation", () => {
    const plan = TurnItem.cases.Plan.make({
      id: "p",
      steps: [{ text: "Run the tests", status: "in-progress", detail: "Running the tests" }],
      explanation: "Tests first.",
    });

    expect(completedItemView(plan)).toMatchObject({
      kind: "plan",
      steps: [{ text: "Run the tests", status: "in-progress", detail: "Running the tests" }],
      explanation: "Tests first.",
    });
  });
});
