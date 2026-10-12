import { describe, expect, test } from "bun:test";
import { chooseCollapse, collapseChoice, initialOpen, outputOpen } from "./collapse.ts";

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

  test("the latest Turn stays open: no fold after success", () => {
    expect(outputOpen({ ...base, latest: true })).toBe(true);
    expect(outputOpen({ ...base, latest: true, choice: false })).toBe(false);
  });
});

describe("in-Turn defaults", () => {
  test("open in the latest Turn, and kept open once it isn't", () => {
    expect(initialOpen("run:a", true)).toBe(true);
    expect(initialOpen("run:a", false)).toBe(true);
    expect(initialOpen("run:b", false)).toBe(false);
  });

  test("the user's choice wins", () => {
    chooseCollapse("run:c", false);
    expect(initialOpen("run:c", true)).toBe(false);
  });
});
