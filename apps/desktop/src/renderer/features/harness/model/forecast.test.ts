import { describe, expect, test } from "bun:test";
import {
  forecast,
  paceCell,
  paceWords,
  runWords,
  sessionWords,
  shortForecast,
  spanWords,
} from "./forecast.ts";
import type { LimitData } from "./limits.ts";

const NOW = Date.parse("2026-10-01T12:00:00Z");

const HOUR = 3_600_000;

const at = (ms: number) => new Date(NOW + ms).toISOString();

/** A five-hour window that resets `resetsIn` from now. */
const limit = (usedPercent: number | null, resetsIn: number, patch: Partial<LimitData> = {}) =>
  ({
    harness: "claude",
    kind: "five-hour",
    scope: null,
    windowMinutes: 300,
    usedPercent,
    status: "ok",
    resetsAt: at(resetsIn),
    observedAt: at(0),
    plan: "max",
    weeklyPerSession: null,
    ...patch,
  }) satisfies LimitData;

describe("pace", () => {
  test("half the window gone, 40% used: 10% in reserve, lasts until reset", () => {
    const f = forecast(limit(40, 2.5 * HOUR), NOW);

    expect(f?.expectedUsed).toBeCloseTo(50);
    expect(f === null ? null : [paceWords(f), runWords(f)]).toEqual([
      "10% in reserve",
      "Lasts until reset",
    ]);
  });

  test("ahead of the pace: in deficit, and when it runs out", () => {
    // 1h gone of 5, 40% used: 40%/h, 60% left runs out in 1h30m (before the reset in 4h).
    const f = forecast(limit(40, 4 * HOUR), NOW);

    expect(f === null ? null : [paceWords(f), runWords(f)]).toEqual([
      "20% in deficit",
      "Runs out in 1h 30m",
    ]);
    expect(f === null ? null : shortForecast(f)).toBe("runs out in 1h 30m");
  });

  test("within two points reads on pace", () => {
    const f = forecast(limit(50.5, 2.5 * HOUR), NOW);

    expect(f === null ? null : [paceWords(f), shortForecast(f)]).toEqual(["On pace", "on pace"]);
  });

  test("flat usage lasts until reset", () => {
    const f = forecast(limit(0, 2 * HOUR), NOW);

    expect(f === null ? null : [paceWords(f), runWords(f)]).toEqual([
      "60% in reserve",
      "Lasts until reset",
    ]);
  });

  test("just reset: a pace, but too early to project", () => {
    const f = forecast(limit(3, 5 * HOUR - 5 * 60_000), NOW);

    expect(f === null ? null : [paceWords(f), runWords(f)]).toEqual(["On pace", null]);
  });

  test("nothing to say: no percentage, no reset, a past or impossible reset, or over the limit", () => {
    expect(forecast(limit(null, HOUR), NOW)).toBeNull();
    expect(forecast(limit(10, HOUR, { resetsAt: null }), NOW)).toBeNull();
    expect(forecast(limit(10, -HOUR), NOW)).toBeNull();
    expect(forecast(limit(10, 9 * HOUR), NOW)).toBeNull();
    expect(forecast(limit(100, HOUR), NOW)).toBeNull();
    expect(forecast(limit(80, HOUR, { status: "reached" }), NOW)).toBeNull();
  });

  test("a window with no length falls back by kind", () => {
    expect(forecast(limit(10, HOUR, { windowMinutes: null }), NOW)?.expectedUsed).toBeCloseTo(80);
    expect(forecast(limit(10, HOUR, { kind: "monthly", windowMinutes: null }), NOW)).toBeNull();
  });
});

describe("weekly", () => {
  const weekly = (used: number, perSession: number | null) =>
    limit(used, 4 * 24 * HOUR + 22 * HOUR, {
      kind: "weekly",
      windowMinutes: 10_080,
      weeklyPerSession: perSession,
    });

  test("full 5-hour windows left and until the reset, when the Daemon has a typical one", () => {
    const f = forecast(weekly(62, 14.6), NOW, true);

    expect(f === null ? null : sessionWords(f)).toBe(
      "About 2.6 full 5-hour windows left · 23 until reset"
    );
  });

  test("not without the Daemon's estimate, a 5-hour window, or on a scoped weekly", () => {
    expect(forecast(weekly(62, null), NOW, true)?.sessionsLeft).toBeNull();
    expect(forecast(weekly(62, 14.6), NOW, false)?.sessionsLeft).toBeNull();
    expect(forecast({ ...weekly(62, 14.6), scope: "Fable" }, NOW, true)?.sessionsLeft).toBeNull();
  });

  test("one window or less reads singular", () => {
    const f = forecast(weekly(90, 10), NOW, true);

    expect(f === null ? null : sessionWords(f)).toBe(
      "About 1 full 5-hour window left · 23 until reset"
    );
  });
});

describe("words and marker", () => {
  test("spans", () => {
    expect([30_000, 40 * 60_000, 3 * HOUR + 34 * 60_000, 70 * HOUR].map(spanWords)).toEqual([
      "<1m",
      "40m",
      "3h 34m",
      "2d 22h",
    ]);
  });

  test("the pace marker sits on the last cell that would be full on pace", () => {
    const at = (resetsIn: number) => {
      const f = forecast(limit(10, resetsIn), NOW);

      return f === null ? null : paceCell(f, 40);
    };

    expect([at(5 * HOUR), at(2.5 * HOUR), at(60_000)]).toEqual([39, 19, 0]);
  });
});
