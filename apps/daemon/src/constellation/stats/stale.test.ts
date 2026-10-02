import { expect, test } from "bun:test";
import { AttemptId } from "@polaris/protocol";
import { staleDuration, type StaleTransition } from "./stale.ts";
import { time } from "./stats.testing.ts";

const attempt = AttemptId.make("a");

const next = AttemptId.make("b");

const transition = (id: AttemptId, at: number, stale: boolean): StaleTransition => ({
  attemptId: id,
  at: time(at),
  stale,
});

const duration = (facts: ReadonlyArray<StaleTransition>, start: number, end: number) =>
  staleDuration(facts, attempt, Date.parse(time(start)), Date.parse(time(end)));

test("stale/fresh boundaries integrate repeated intervals and ignore another Attempt sharing a Session", () => {
  const facts = [
    transition(attempt, 1000, true),
    transition(next, 1500, true),
    transition(attempt, 2500, false),
    transition(attempt, 3000, true),
    transition(next, 4000, false),
    transition(attempt, 4500, false),
  ];

  expect(duration(facts, 0, 5000)).toBe(3000);
  expect(duration(facts, 2000, 4000)).toBe(1500);
});

test("open stale intervals survive a replay and advance on view without a fresh event", () => {
  const facts = [transition(attempt, 1000, true)];
  expect(duration(facts, 0, 4000)).toBe(3000);
  expect(duration([...facts], 0, 5000)).toBe(4000);
  expect(duration([...facts, transition(attempt, 3500, false)], 0, 5000)).toBe(2500);
});

test("duplicate stale/fresh observations are idempotent and fresh without stale adds nothing", () => {
  const facts = [
    transition(attempt, 500, false),
    transition(attempt, 1000, true),
    transition(attempt, 2000, true),
    transition(attempt, 3000, false),
    transition(attempt, 4000, false),
  ];

  expect(duration(facts, 0, 5000)).toBe(2000);
  expect(duration([], 0, 5000)).toBe(0);
});

test("stale periods clip to the Attempt window including pre-start and future observations", () => {
  expect(
    duration([transition(attempt, -1000, true), transition(attempt, 10000, false)], 0, 5000)
  ).toBe(5000);
  expect(duration([transition(attempt, 10000, true)], 0, 5000)).toBe(0);
});
