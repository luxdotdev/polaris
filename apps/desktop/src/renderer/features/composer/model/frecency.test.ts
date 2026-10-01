import { describe, expect, test } from "bun:test";
import { frecencyScore, MAX_ENTRIES, recordPick, topFrecent } from "./frecency.ts";

const NOW = Date.UTC(2026, 9, 1, 12);

const HOUR = 60 * 60 * 1000;

const DAY = 24 * HOUR;

describe("frecency", () => {
  test("recent picks weigh more than old ones, and count multiplies", () => {
    const fresh = { count: 1, picks: [NOW - 10 * 60 * 1000] };
    const stale = { count: 1, picks: [NOW - 20 * DAY] };

    expect(frecencyScore(fresh, NOW)).toBe(100);
    expect(frecencyScore(stale, NOW)).toBe(5);
    expect(frecencyScore({ count: 3, picks: [NOW, NOW - 2 * HOUR] }, NOW)).toBe(
      ((100 + 70) / 2) * 3
    );
    expect(frecencyScore(undefined, NOW)).toBe(0);
  });

  test("count stops counting at 40, and only the last 10 picks are sampled", () => {
    let table = {};

    for (let i = 0; i < 60; i++) table = recordPick(table, "/compact", NOW - i * 1000);

    const entry = recordPick(table, "/compact", NOW)["/compact"];

    expect(entry?.count).toBe(61);
    expect(entry?.picks).toHaveLength(10);
    expect(frecencyScore(entry, NOW)).toBe(100 * 40);
  });

  test("the table stays bounded, dropping the lowest scores", () => {
    const LONG_AGO = NOW - 30 * DAY;
    let table = recordPick(recordPick({}, "/often", LONG_AGO), "/often", LONG_AGO);

    for (let i = 1; i < MAX_ENTRIES; i++) table = recordPick(table, `/c${i}`, LONG_AGO);

    table = recordPick(table, "/fresh", NOW);

    expect(Object.keys(table)).toHaveLength(MAX_ENTRIES);
    expect(table).toHaveProperty("/fresh");
    expect(table).toHaveProperty("/often");
  });

  test("topFrecent lists the highest scores first", () => {
    let table = recordPick({}, "/old", NOW - 10 * DAY);

    table = recordPick(recordPick(table, "/often", NOW - DAY), "/often", NOW - 2 * DAY);
    table = recordPick(table, "/now", NOW);

    expect(topFrecent(table, 2, NOW)).toEqual(["/now", "/often"]);
  });
});
