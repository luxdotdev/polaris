import { describe, expect, test } from "bun:test";
import { chooseCollapse, collapseChoice, outputOpen } from "./collapse.ts";

const base = { running: false, failed: false, settled: true, choice: null };

describe("command output folding", () => {
  test("a settled success folds", () => {
    expect(outputOpen(base)).toBe(false);
    expect(outputOpen({ ...base, settled: false })).toBe(true);
  });

  test("never while running or failed", () => {
    expect(outputOpen({ ...base, running: true })).toBe(true);
    expect(outputOpen({ ...base, failed: true })).toBe(true);
  });

  test("the user's choice wins and is remembered per item", () => {
    expect(outputOpen({ ...base, choice: true })).toBe(true);
    expect(outputOpen({ ...base, failed: true, choice: false })).toBe(false);
    expect(collapseChoice("c-remembered")).toBeNull();
    chooseCollapse("c-remembered", true);
    expect(collapseChoice("c-remembered")).toBe(true);
  });
});
