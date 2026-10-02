import { describe, expect, test } from "bun:test";
import { C1, C2 } from "../../sessions/preview/fixtures.ts";
import { C1_STATS, USAGE } from "../../sessions/preview/settingsFixtures.ts";
import { byConstellation, duration } from "./byConstellation.ts";
import type { Bucket } from "./usage.ts";

const buckets: ReadonlyArray<Bucket> = USAGE.report.buckets;

describe("byConstellation", () => {
  const rows = byConstellation({ buckets, views: [C1, C2], now: Date.now() });

  test("splits the Lead from its workers, per Task, most tokens first", () => {
    expect(rows.map((r) => r.name)).toEqual(["Constellations v1", "Bench leases"]);

    const [c1] = rows;

    expect(c1?.lead.tokens).toBe(7_300_000);
    expect(c1?.tasks.map((t) => t.taskId)).toEqual(["A1", "A2", "B1", "B2", "B3", "B5"]);
    expect(c1?.workers.tokens).toBe(20_900_000);
    expect(c1?.total.tokens).toBe(28_200_000);
  });

  test("sessions outside every Constellation stay out", () => {
    const all = rows.reduce((n, r) => n + r.total.tokens, 0);

    expect(all).toBe(28_200_000 + 3_900_000);
  });

  test("with no Usage a Constellation isn't listed", () => {
    expect(byConstellation({ buckets: [], views: [C1], now: 0 })).toEqual([]);
  });
});

describe("with stats from the lead's host", () => {
  const stats = new Map([["c1", C1_STATS]]);
  const rows = byConstellation({ buckets, views: [C1, C2], stats, now: Date.now() });
  const c1 = rows.find((r) => r.id === "c1");
  const c2 = rows.find((r) => r.id === "c2");

  test("per-response figures, priced like Usage, and the host's wall clock", () => {
    expect(c1?.source).toBe("stats");
    expect(c1?.lead.tokens).toBe(7_300_000);
    expect(c1?.workers.tokens).toBe(20_900_000);
    expect(c1?.tasks.map((t) => t.taskId)).toEqual(["A1", "A2", "B1", "B2", "B3", "B5"]);
    expect(c1?.total.cost.usd).toBeCloseTo(28.2);
    expect(c1?.total.cost.estimated).toBe(true);
    expect(c1?.durationMs).toBe(134 * 60_000);
  });

  test("says what it leaves out, and that remote workers are joined by the hour", () => {
    expect(c1?.notes).toEqual([
      "This host can't read B4's usage on devbox.",
      "Workers on other hosts are added from those hosts' usage, by the hour.",
    ]);
  });

  test("a Constellation without stats is estimated by the hour, and says so", () => {
    expect(c2?.source).toBe("hourly");
    expect(c2?.notes).toEqual([
      "Estimated by the hour: the lead's host has no constellation stats.",
    ]);
  });
});

test("duration", () => {
  expect(duration(41 * 60_000)).toBe("41m");
  expect(duration(134 * 60_000)).toBe("2h 14m");
  expect(duration(74 * 3_600_000)).toBe("3d 2h");
});
