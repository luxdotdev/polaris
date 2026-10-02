import { describe, expect, test } from "bun:test";
import { statsFixture } from "../preview/stats.ts";
import { completionFacts, duration, statsCoverage, statsGroups, tokens, usd } from "./stats.ts";

const view = statsFixture(37);

const group = (title: string) =>
  statsGroups(view, (id) => `Task ${id}`).find((g) => g.title === title);

describe("stats", () => {
  test("durations, money and tokens read short", () => {
    expect(duration(40_000)).toBe("40s");
    expect(duration(4 * 60_000)).toBe("4m");
    expect(duration(125 * 60_000)).toBe("2h 5m");
    expect(usd(0)).toBe("$0");
    expect(usd(0.004)).toBe("<$0.01");
    expect(usd(3.333)).toBe("$3.33");
    expect(tokens(940)).toBe("940");
    expect(tokens(182_400)).toBe("182k");
    expect(tokens(1_400_000)).toBe("1.4M");
  });

  test("an unrecorded metric says so with the Daemon's reason, never zero", () => {
    const offline = group("Workers")?.lines.find((l) => l.label === "Host offline");

    expect(offline).toMatchObject({ value: "not recorded", missing: true });
    expect(offline?.note).toContain("L stale/fresh");
  });

  test("cost is priced in main; unpriced tokens are called out", () => {
    const cost = group("Constellation")?.lines.find((l) => l.label === "Cost");

    expect(cost).toMatchObject({ value: "$3.33", note: "some tokens have no price" });

    const unpriced = statsGroups({ ...view, pricesFetchedAt: null }, String).find(
      (g) => g.title === "Constellation"
    );

    expect(unpriced?.lines.find((l) => l.label === "Cost")?.note).toContain("reported cost only");
  });

  test("review: first-time acceptance and send-backs by cause", () => {
    const lines = group("Review")?.lines ?? [];

    expect(lines.find((l) => l.label === "Accepted first time")?.value).toBe("3 of 4 · 75%");
    expect(lines.find((l) => l.label === "Sent back")?.value).toBe(
      "1 sent back · 1 merge conflict"
    );
  });

  test("the costliest tasks come first", () => {
    expect(group("Costliest tasks")?.lines.map((l) => l.label)).toEqual([
      "B2 · Task B2",
      "B1 · Task B1",
      "A2 · Task A2",
    ]);
  });

  test("coverage notes say when Usage is partial", () => {
    expect(statsCoverage(view)).toEqual([
      "Usage is still being indexed on this Host; totals will grow.",
      "Usage is local to this Host; remote worker Usage must be joined by the Client.",
    ]);
  });

  test("the completion card leads with tasks done and wall clock", () => {
    expect(completionFacts(view, 8, 10).headline).toBe("8 of 10 tasks done in 4h 12m");
  });
});
