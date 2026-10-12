import { describe, expect, test } from "bun:test";
import { capacityReset, failedText, neutralFailure } from "./failure.ts";
import { clock } from "./copy.ts";

describe("failure words", () => {
  const at = "2026-10-11T14:00:00Z";

  test("a capacity failure is a usage limit with its reset", () => {
    expect(failedText("capacity", at)).toBe(`Usage limit · resets ${clock(at)}`);
    expect(failedText("capacity", null)).toBe("Usage limit · reset time unknown");
    expect(capacityReset(undefined)).toBe("reset time unknown");
  });

  test("other kinds name themselves; an unclassified failure is just failed", () => {
    expect(failedText("transport", null)).toBe("failed · connection");
    expect(failedText("harness", null)).toBe("failed · harness error");
    expect(failedText("implementation", null)).toBe("failed · implementation");
    expect(failedText(null, null)).toBe("failed");
  });

  test("only an implementation failure keeps the failed colour", () => {
    expect(neutralFailure("capacity")).toBe(true);
    expect(neutralFailure("transport")).toBe(true);
    expect(neutralFailure("implementation")).toBe(false);
    expect(neutralFailure(null)).toBe(false);
  });
});
