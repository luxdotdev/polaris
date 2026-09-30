import { describe, expect, test } from "bun:test";
import { freshness, type Limit, limitRows, resetPhrase } from "./planLimits.ts";

const NOW = Date.parse("2026-09-30T15:00:00Z");

const limit = (patch: Partial<Limit>): Limit => ({
  harness: "claude",
  kind: "five-hour",
  scope: null,
  windowMinutes: 300,
  usedPercent: 62,
  status: "ok",
  resetsAt: "2026-09-30T16:48:00Z",
  observedAt: "2026-09-30T14:58:00Z",
  plan: "max",
  ...patch,
});

describe("limitRows", () => {
  test("one row per Harness, windows in order, 40-cell meters", () => {
    const rows = limitRows(
      [limit({ kind: "weekly", usedPercent: 34, resetsAt: null }), limit({})],
      NOW
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.caption).toBe("Max · live");
    expect(rows[0]?.windows.map((w) => [w.label, w.percent, w.litCells, w.note])).toEqual([
      ["5-hour window", "62%", 25, "Resets in 1h 48m"],
      ["Weekly", "34%", 14, ""],
    ]);
  });

  test("near a limit the words change, not the colour", () => {
    const [row] = limitRows([limit({ status: "warning", usedPercent: 91 })], NOW);

    expect(row?.windows[0]?.note).toBe("Near the limit · resets in 1h 48m");
  });

  test("the newest reading wins when several Hosts report the same window", () => {
    const [row] = limitRows(
      [
        limit({ usedPercent: 10, observedAt: "2026-09-30T14:00:00Z" }),
        limit({ usedPercent: 20, observedAt: "2026-09-30T14:20:00Z" }),
      ],
      NOW
    );

    expect([row?.windows[0]?.percent, row?.caption]).toEqual(["20%", "Max · as of 40m ago"]);
  });
});

describe("phrases", () => {
  test("freshness and resets", () => {
    expect(freshness("2026-09-30T14:58:00Z", NOW)).toBe("live");
    expect(freshness("2026-09-30T11:00:00Z", NOW)).toBe("as of 4h ago");
    expect(resetPhrase("2026-09-30T15:30:00Z", NOW)).toBe("in 30m");
    expect(resetPhrase("2026-10-05T09:00:00Z", NOW)).toMatch(/^[A-Z][a-z]{2} \d\d:\d\d$/);
  });
});
