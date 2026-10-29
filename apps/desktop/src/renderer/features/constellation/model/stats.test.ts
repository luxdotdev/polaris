import { describe, expect, test } from "bun:test";
import { TaskId } from "@polaris/protocol";
import { c1Tasks, task, treeTasks } from "../preview/graph.ts";
import { statsFixture } from "../preview/stats.ts";
import {
  completionHeadline,
  completionTally,
  duration,
  statsCoverage,
  tokens,
  usd,
} from "./stats.ts";
import type { Node } from "./tree.ts";
import { MAX_COLUMNS, statsPanel } from "./statsPanel.ts";

const view = statsFixture(37);

const panel = statsPanel(view, (id) => `Task ${id}`);

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

  test("an unrecorded time says so with the Daemon's reason and takes no share of the bar", () => {
    const offline = panel.workers.segments.find((s) => s.key === "offline");

    expect(offline).toMatchObject({ ms: null, text: "not recorded", share: 0 });
    expect(offline?.note).toContain("L stale/fresh");

    const shares = panel.workers.segments.reduce((sum, s) => sum + s.share, 0);

    expect(shares).toBeCloseTo(1);
  });

  test("cost is priced in main; unpriced tokens are called out", () => {
    expect(panel.headline).toMatchObject({
      primary: "$3.33",
      caption: "Cost · some tokens have no price",
    });

    const unpriced = statsPanel({ ...view, pricesFetchedAt: null }, String);

    expect(unpriced.headline.caption).toContain("reported cost only");
  });

  test("the role split shares the cost and carries each role's Harness", () => {
    expect(panel.roles.map((r) => [r.label, r.harness, Math.round(r.share * 100)])).toEqual([
      ["Lead", "claude", 18],
      ["Workers", "codex", 82],
    ]);
  });

  test("review: a cell per first Claim, accepted ones first; causes read as words", () => {
    expect(panel.review.cells.map((c) => c.accepted)).toEqual([true, true, true, false]);
    expect(panel.review.summary).toBe("3 of 4 tasks accepted first time");
    expect(panel.review.sentBack).toBe("1 sent back · 1 merge conflict");
  });

  test("a column per update turn, the tallest full height", () => {
    const { columns, measure } = panel.lead;

    expect(measure).toBe("cost");
    expect(columns).toHaveLength(view.stats.lead.digests.length);
    expect(Math.max(...columns.map((c) => c.height))).toBe(1);
    expect(columns[0]?.label).toBe("Update turn 1 · 3 updates · 288k tokens · $0.37");
  });

  test("past the column limit, update turns are summed into runs", () => {
    const digests = Array.from({ length: 33 }, () => view.stats.lead.digests).flat();
    const perDigest = Array.from({ length: 33 }, () => view.usage.perDigest).flat();

    const big = statsPanel(
      {
        ...view,
        stats: { ...view.stats, lead: { ...view.stats.lead, digests } },
        usage: { ...view.usage, perDigest },
      },
      String
    );

    expect(big.lead.columns.length).toBeLessThanOrEqual(MAX_COLUMNS);
    expect(big.lead.columns[0]?.label).toStartWith("Update turns 1–7 · ");
  });

  test("in tokens, every chart is re-measured and money moves to the second line", () => {
    const counted = statsPanel(view, (id) => `Task ${id}`, "tokens");

    expect(counted.headline).toMatchObject({ primary: "1.4M", unit: "tokens" });
    expect(counted.headline.secondary).toStartWith("$3.33 · ");
    expect(counted.roles.map((r) => [r.value, r.detail])).toEqual([
      ["485k tokens", "$0.61"],
      ["922k tokens", "$2.72"],
    ]);
    expect(counted.lead.measure).toBe("tokens");
    expect(counted.tasks[0]).toMatchObject({ taskId: "B2", value: "279k", share: 1 });
  });

  test("with nothing priced, cost can't be shown and tokens stand in", () => {
    const zero = {
      ...view.usage.total,
      estimates: view.usage.total.estimates.map(() => ({ estimatedUsd: 0, unpricedTokens: 0 })),
    };

    const free = statsPanel({ ...view, usage: { ...view.usage, total: zero } }, String, "cost");

    expect(free).toMatchObject({ priced: false, measure: "tokens" });
  });

  test("the costliest tasks come first, bars relative to the top one", () => {
    expect(panel.tasks.map((t) => [t.taskId, t.title, Math.round(t.share * 100)])).toEqual([
      ["B2", "Task B2", 100],
      ["B1", "Task B1", 87],
      ["A2", "Task A2", 61],
      ["A1", "Task A1", 50],
      ["B3", "Task B3", 26],
    ]);
  });

  test("coverage notes say when Usage is partial", () => {
    expect(statsCoverage(view)).toEqual([
      "Usage is still being indexed on this host; totals will grow.",
      "Usage is local to this Host; remote worker Usage must be joined by the Client.",
    ]);
  });

  test("workers' working time reads against the wall clock", () => {
    expect(panel.workers.working).toBe("3h 32m working in 4h 12m");
  });

  test("the completion card counts Gates and leaf Tasks, never Parents or canceled Tasks", () => {
    const tasks: ReadonlyArray<Node> = [
      ...c1Tasks.slice(0, 3),
      ...treeTasks,
      { id: TaskId.make("S"), deps: [], canceled: true },
      task({ id: "X", title: "Emptied parent" }),
      { id: TaskId.make("X1"), deps: [], parent: TaskId.make("X"), canceled: true },
    ];

    const done = ["A1", "A2", "G1", "F1a", "F1", "S"];

    const tally = completionTally(
      tasks,
      tasks.map((t) => ({ taskId: t.id, state: done.includes(t.id) ? "done" : "working" }))
    );

    expect(tally).toEqual({ done: 4, count: 8 });
    expect(completionHeadline(tally)).toBe("4 of 8 tasks done");
  });
});
