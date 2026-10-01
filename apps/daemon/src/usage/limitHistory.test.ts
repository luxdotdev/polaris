import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { PlanLimit } from "@polaris/protocol";
import {
  historyKey,
  limitHistory,
  MAX_READINGS,
  type Reading,
  RETAIN_MS,
  weeklyPerSession,
} from "./limitHistory.ts";

const T0 = Date.parse("2026-09-28T00:00:00Z");

const HOUR = 3_600_000;

const reading = (kind: string, at: number, used: number, resets: number) =>
  new PlanLimit({
    harness: "claude",
    kind,
    scope: null,
    windowMinutes: kind === "weekly" ? 10_080 : 300,
    usedPercent: used,
    status: "ok",
    resetsAt: new Date(resets).toISOString(),
    observedAt: new Date(at).toISOString(),
    plan: "max",
  });

describe("plan limit history", () => {
  test("readings older than the retention go on the next write", () => {
    const history = limitHistory(new Database(":memory:"));
    const key = historyKey({ harness: "claude", kind: "five-hour", scope: null });

    history.record(reading("five-hour", T0, 10, T0 + 5 * HOUR));
    history.record(reading("five-hour", T0 + HOUR, 20, T0 + 5 * HOUR));
    history.record(reading("five-hour", T0 + RETAIN_MS + 2 * HOUR, 5, T0 + RETAIN_MS + 6 * HOUR));

    expect(history.readings(key, 0).map((r) => r.used)).toEqual([5]);
  });

  test("a window keeps at most MAX_READINGS", () => {
    const history = limitHistory(new Database(":memory:"));
    const key = historyKey({ harness: "claude", kind: "five-hour", scope: null });

    for (let i = 0; i < MAX_READINGS + 5; i++)
      history.record(reading("five-hour", T0 + i * 1000, i % 100, T0 + 5 * HOUR));

    const kept = history.readings(key, 0);

    expect(kept).toHaveLength(MAX_READINGS);
    expect(kept[0]?.observed).toBe(T0 + 5 * 1000);
  });

  test("status-only readings aren't kept", () => {
    const history = limitHistory(new Database(":memory:"));

    const statusOnly = new PlanLimit({
      harness: "claude",
      kind: "weekly",
      scope: null,
      windowMinutes: 10_080,
      usedPercent: null,
      status: "reached",
      resetsAt: new Date(T0 + HOUR).toISOString(),
      observedAt: new Date(T0).toISOString(),
      plan: "max",
    });

    history.record(statusOnly);
    expect(history.readings(historyKey(statusOnly), 0)).toEqual([]);
  });
});

/** A finished 5-hour window from `start`, used 0 → `session`%, while the weekly went `from` → `to`. */
const window5 = (start: number, session: number, from: number, to: number) => {
  const resets = start + 5 * HOUR;
  const weeklyResets = T0 + 7 * 24 * HOUR;

  const five: Array<Reading> = [
    { observed: start + HOUR, used: 1, resets },
    { observed: start + 4 * HOUR, used: session, resets },
  ];

  const weekly: Array<Reading> = [
    { observed: start + HOUR, used: from, resets: weeklyResets },
    { observed: start + 4 * HOUR, used: to, resets: weeklyResets },
  ];

  return { five, weekly };
};

describe("weekly per session", () => {
  const now = T0 + 6 * 24 * HOUR;

  test("the median of finished 5-hour windows, scaled to a full one", () => {
    const parts = [
      window5(T0, 51, 0, 5), // 5% for 50 points of session: 10 per full window
      window5(T0 + 6 * HOUR, 41, 5, 13), // 8 for 40: 20
      window5(T0 + 12 * HOUR, 26, 13, 16.75), // 3.75 for 25: 15
    ];

    expect(
      weeklyPerSession(
        parts.flatMap((p) => p.five),
        parts.flatMap((p) => p.weekly),
        now
      )
    ).toBeCloseTo(15);
  });

  test("fewer than three finished windows: not well-founded", () => {
    const parts = [window5(T0, 51, 0, 5), window5(T0 + 6 * HOUR, 41, 5, 13)];

    expect(
      weeklyPerSession(
        parts.flatMap((p) => p.five),
        parts.flatMap((p) => p.weekly),
        now
      )
    ).toBeNull();
  });

  test("the window still running doesn't count, nor one with no weekly change", () => {
    const parts = [
      window5(T0, 51, 0, 5),
      window5(T0 + 6 * HOUR, 41, 5, 5),
      window5(T0 + 12 * HOUR, 26, 5, 8),
      window5(now - HOUR, 30, 8, 12),
    ];

    expect(
      weeklyPerSession(
        parts.flatMap((p) => p.five),
        parts.flatMap((p) => p.weekly),
        now
      )
    ).toBeNull();
  });
});
