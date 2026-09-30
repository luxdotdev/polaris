import { describe, expect, test } from "bun:test";
import { questionAnswers } from "./question.ts";

describe("question answers", () => {
  test("the Harness's (Recommended) marker fills that row and leaves the label", () => {
    expect(questionAnswers(["Keep 20px (Recommended)", "Use 18px"])).toEqual([
      { label: "Keep 20px", value: "Keep 20px (Recommended)", recommended: true },
      { label: "Use 18px", value: "Use 18px", recommended: false },
    ]);
  });

  test("no marker, nothing filled; only the first marked one counts", () => {
    expect(questionAnswers(["A", "B"]).some((a) => a.recommended)).toBe(false);
    expect(
      questionAnswers(["A (recommended)", "B (Recommended)"]).map((a) => a.recommended)
    ).toEqual([true, false]);
  });
});
