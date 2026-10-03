import { describe, expect, test } from "bun:test";
import { LANE_MAX, LANE_MIN, laneWidth } from "./lane.ts";

describe("laneWidth", () => {
  test("fits the longest id, so every row in the view shares it", () => {
    expect(laneWidth(["A1", "email-validator", "B2"], LANE_MAX.tab)).toBe(15);
  });

  test("never narrower than a short id", () => {
    expect(laneWidth(["B"], LANE_MAX.tab)).toBe(LANE_MIN);
    expect(laneWidth([], LANE_MAX.tab)).toBe(LANE_MIN);
  });

  test("stops at the view's max; longer ids truncate", () => {
    expect(laneWidth(["worktree-setup-retry-on-reconnect"], LANE_MAX.tab)).toBe(LANE_MAX.tab);
    expect(laneWidth(["handoff-hardening"], LANE_MAX.sidebar)).toBe(LANE_MAX.sidebar);
  });
});
