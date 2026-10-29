import { describe, expect, test } from "bun:test";
import { chartLayout, columnsFor, dotRows, GEOMETRY, isCompact, taskCode } from "./layout.ts";
import type { StarBand, StarTask } from "./types.ts";

const bands: ReadonlyArray<StarBand> = [
  { id: "a", letter: "A", name: "protocol" },
  { id: "b", letter: "B", name: "daemon" },
  { id: "c", letter: "C", name: "mobile" },
];

const task = (id: string, band: string, wave: number, dependsOn: Array<string> = []): StarTask => ({
  id,
  label: id,
  band,
  wave,
  state: "waiting",
  dependsOn,
});

const many = (n: number): Array<StarTask> =>
  Array.from({ length: n }, (_, i) => task(`t${i}`, "a", i % 5));

const WIDTH = 333;

describe("isCompact", () => {
  test.each([
    [30, false],
    [31, true],
  ])("%i tasks compress: %p", (n, compact) => {
    expect(isCompact(many(n))).toBe(compact);
  });

  test("an explicit choice wins over the count", () => {
    expect(isCompact(many(60), false)).toBe(false);
    expect(isCompact(many(3), true)).toBe(true);
  });
});

describe("chartLayout", () => {
  test("a wave is a column and a band a row, in the bands' order", () => {
    const layout = chartLayout(
      [task("c1", "c", 1), task("a2", "a", 2), task("a1", "a", 1)],
      bands,
      WIDTH
    );

    const at = new Map(layout.stars.map((star) => [star.task.id, star]));

    expect(at.get("a1")?.x).toBe(at.get("c1")?.x);
    expect(at.get("a2")!.x).toBeGreaterThan(at.get("a1")!.x);
    expect(at.get("a1")!.y).toBeLessThan(at.get("c1")!.y);
    expect(layout.badges.map((badge) => badge.band.letter)).toEqual(["A", "C"]);
  });

  test("gaps in the wave numbering don't leave empty columns", () => {
    const layout = chartLayout([task("x", "a", 1), task("y", "a", 7)], bands, WIDTH);
    const [x, y] = layout.stars.map((star) => star.x);

    expect(y! - x!).toBe(GEOMETRY.maxColumnGap);
  });

  test("tasks sharing a band and wave stack around the band's centre, and the band grows", () => {
    const one = chartLayout([task("a1", "a", 1), task("b1", "b", 1)], bands, WIDTH);

    const two = chartLayout(
      [task("a1", "a", 1), task("a1b", "a", 1), task("b1", "b", 1)],
      bands,
      WIDTH
    );

    const stacked = two.stars.filter((star) => star.task.band === "a").map((star) => star.y);

    expect(stacked[1]! - stacked[0]!).toBe(GEOMETRY.stackGap);
    expect(two.height - one.height).toBe(GEOMETRY.stackGap);
    expect(two.badges[0]!.y + GEOMETRY.badge / 2).toBe((stacked[0]! + stacked[1]!) / 2);
  });

  test("every star stays inside the width", () => {
    const tasks = Array.from({ length: 20 }, (_, i) => task(`t${i}`, "b", i));

    for (const width of [200, 333, 600]) {
      for (const star of chartLayout(tasks, bands, width).stars) {
        expect(star.x).toBeLessThanOrEqual(width - GEOMETRY.trailing);
      }
    }
  });

  test("waves that don't fit wrap onto another set of band rows below", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task(`t${i}`, "a", i + 1));
    const { perSegment } = columnsFor(WIDTH, 12);
    const layout = chartLayout(tasks, bands, WIDTH);
    const first = layout.stars.find((star) => star.task.wave === 1)!;
    const wrapped = layout.stars.find((star) => star.task.wave === perSegment + 1)!;

    expect(perSegment).toBeLessThan(12);
    expect(wrapped.x).toBe(first.x);
    expect(wrapped.y).toBeGreaterThan(first.y);
    expect(layout.badges.map((badge) => badge.band.letter)).toEqual(["A", "A"]);
  });

  test("a few waves spread no wider than Paper's 70pt columns", () => {
    expect(columnsFor(WIDTH, 3).gap).toBe(GEOMETRY.maxColumnGap);
    expect(columnsFor(WIDTH, 6).gap).toBeLessThan(GEOMETRY.maxColumnGap);
  });

  test("edges join each task to its upstream ones in the chart, ignoring unknown ids", () => {
    const tasks = [
      task("a1", "a", 1),
      task("b1", "b", 1),
      task("b2", "b", 2, ["a1", "b1", "gone"]),
    ];

    const layout = chartLayout(tasks, bands, WIDTH, (t) => t.dependsOn ?? []);

    expect(layout.edges.map(([from, to]) => `${from.task.id}>${to.task.id}`)).toEqual([
      "a1>b2",
      "b1>b2",
    ]);
  });

  test("a task in an unknown band is kept, in a '?' band last", () => {
    const layout = chartLayout([task("x", "zz", 1), task("a1", "a", 1)], bands, WIDTH);

    expect(layout.stars).toHaveLength(2);
    expect(layout.badges.map((badge) => badge.band.letter)).toEqual(["A", "?"]);
  });
});

describe("dotRows", () => {
  test("a row per band with tasks, dots in wave order", () => {
    const rows = dotRows([task("b3", "b", 3), task("a1", "a", 1), task("b1", "b", 1)], bands);

    expect(rows.map((row) => [row.band.letter, row.tasks.map((t) => t.id)])).toEqual([
      ["A", ["a1"]],
      ["B", ["b1", "b3"]],
    ]);
  });

  test("no task is lost when compressing 60", () => {
    const tasks = Array.from({ length: 60 }, (_, i) =>
      task(`t${i}`, ["a", "b", "c", "x"][i % 4]!, i % 9)
    );

    expect(dotRows(tasks, bands).flatMap((row) => row.tasks)).toHaveLength(60);
  });
});

test("taskCode is the band letter and wave", () => {
  expect(taskCode(task("x", "b", 3), bands)).toBe("B3");
});
