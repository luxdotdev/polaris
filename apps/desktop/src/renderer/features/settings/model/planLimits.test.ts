import { describe, expect, test } from "bun:test";
import { type Limit, limitRows, resetPhrase } from "./planLimits.ts";

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
  weeklyPerSession: null,
  ...patch,
});

const CLAUDE_RUNNING: ReadonlySet<string> = new Set(["claude"]);

describe("limitRows", () => {
  test("a fresh value reads live only while a session of its Harness runs (V2 bug 5)", () => {
    const [idle] = limitRows([limit({})], NOW, new Set());

    expect(idle?.caption).toBe("Max · as of 2m ago");
  });

  test("one row per Harness, windows in order, 40-cell meters of what's left", () => {
    const rows = limitRows(
      [limit({ kind: "weekly", usedPercent: 34, resetsAt: null }), limit({})],
      NOW,
      CLAUDE_RUNNING
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.caption).toBe("Max · live");
    expect(rows[0]?.windows.map((w) => [w.label, w.left, w.filledCells, w.note])).toEqual([
      ["5-hour window", "38% left", 15, "Resets in 1h 48m"],
      ["Weekly", "66% left", 26, ""],
    ]);
  });

  test("near a limit the words change, not the colour", () => {
    const [row] = limitRows([limit({ status: "warning", usedPercent: 91 })], NOW, CLAUDE_RUNNING);

    expect(row?.windows[0]?.note).toBe("Near the limit · resets in 1h 48m");
  });

  test("the newest reading wins when several Hosts report the same window", () => {
    const [row] = limitRows(
      [
        limit({ usedPercent: 10, observedAt: "2026-09-30T14:00:00Z" }),
        limit({ usedPercent: 20, observedAt: "2026-09-30T14:20:00Z" }),
      ],
      NOW,
      CLAUDE_RUNNING
    );

    expect([row?.windows[0]?.left, row?.caption]).toEqual(["80% left", "Max · as of 40m ago"]);
  });
});

describe("meters count down", () => {
  const win = (patch: Partial<Limit>) => limitRows([limit(patch)], NOW, new Set())[0]?.windows[0];

  test("the edges agree with the words", () => {
    expect([win({ usedPercent: 0 })?.left, win({ usedPercent: 0 })?.filledCells]).toEqual([
      "100% left",
      40,
    ]);
    expect([win({ usedPercent: 0.4 })?.left, win({ usedPercent: 0.4 })?.filledCells]).toEqual([
      "99% left",
      39,
    ]);
    expect([win({ usedPercent: 99.6 })?.left, win({ usedPercent: 99.6 })?.filledCells]).toEqual([
      "<1% left",
      1,
    ]);
    expect([win({ usedPercent: 100 })?.left, win({ usedPercent: 100 })?.filledCells]).toEqual([
      "0% left",
      0,
    ]);
  });

  test("out-of-range readings are clamped", () => {
    expect(win({ usedPercent: 140 })?.filledCells).toBe(0);
    expect(win({ usedPercent: -5 })?.left).toBe("100% left");
  });

  test("near a limit only the words change: 8% left", () => {
    const near = win({ usedPercent: 92, status: "warning" });

    expect([near?.left, near?.filledCells, near?.note]).toEqual([
      "8% left",
      3,
      "Near the limit · resets in 1h 48m",
    ]);
  });

  test("a status-only reading fills by status", () => {
    expect(win({ usedPercent: null, status: "reached" })?.filledCells).toBe(0);
    expect(win({ usedPercent: null, status: "ok" })?.filledCells).toBe(40);
    expect(win({ usedPercent: null })?.left).toBeNull();
  });

  test("three windows, as Claude reports them with a model-scoped weekly", () => {
    const [row] = limitRows(
      [limit({}), limit({ kind: "weekly" }), limit({ kind: "weekly", scope: "Fable" })],
      NOW,
      new Set()
    );

    expect(row?.windows.map((w) => w.label)).toEqual(["5-hour window", "Weekly", "Weekly · Fable"]);
  });
});

describe("phrases", () => {
  test("resets", () => {
    expect(resetPhrase("2026-09-30T15:30:00Z", NOW)).toBe("in 30m");
    expect(resetPhrase("2026-10-05T09:00:00Z", NOW)).toMatch(/^[A-Z][a-z]{2} \d\d:\d\d$/);
  });
});
