import { expect, test } from "bun:test";
import { legend } from "./legend.ts";
import type { StarState, StarTask } from "./types.ts";

const tasks = (...states: Array<StarState>): Array<StarTask> =>
  states.map((state, i) => ({ id: `t${i}`, label: "", band: "a", wave: 1, state }));

test("MX-W's legend: claims to review, blocked, then working and waiting", () => {
  expect(
    legend(
      tasks("review", "blocked", "working", "working", "waiting", "waiting", "waiting", "done"),
      false
    )
  ).toEqual({ review: "1 claim to review", trouble: "1 blocked", rest: "2 working · 3 waiting" });
});

test("MX-X's legend is shorter and leaves the rest to View all tasks", () => {
  expect(legend(tasks("review", "review", "failed", "working"), true)).toEqual({
    review: "2 claims",
    trouble: "1 failed",
    rest: null,
  });
});

test("blocked and failed share the red item; empty counts are left out", () => {
  expect(legend(tasks("blocked", "failed", "failed", "done"), false)).toEqual({
    review: null,
    trouble: "1 blocked · 2 failed",
    rest: null,
  });
});
