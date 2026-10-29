import { describe, expect, test } from "bun:test";
import { TaskId } from "@polaris/protocol";
import { c1Record } from "../preview/graph.ts";
import { chromeTasks } from "../preview/chrome.ts";
import { largeRecord } from "../preview/large.ts";
import { CHART, type ChartTask, type StarChart, starChart } from "./chart.ts";

interface Spec {
  readonly deps?: ReadonlyArray<string>;
  readonly parent?: string;
  readonly group?: string;
  readonly kind?: "task" | "gate";
  readonly canceled?: boolean;
}

const t = (id: string, spec: Spec = {}): ChartTask => ({
  id: TaskId.make(id),
  title: id,
  kind: spec.kind ?? "task",
  deps: (spec.deps ?? []).map((d) => TaskId.make(d)),
  parent: spec.parent === undefined ? null : TaskId.make(spec.parent),
  group: spec.group ?? null,
  canceled: spec.canceled ?? false,
});

const star = (chart: StarChart, id: string) => {
  const s = chart.stars.find((x) => x.id === id);

  if (s === undefined) throw new Error(`${id} is not on the chart`);

  return s;
};

const wavesOf = (chart: StarChart) => Object.fromEntries(chart.stars.map((s) => [s.id, s.wave]));

const edgesOf = (chart: StarChart) =>
  chart.edges.map((e) => `${e.from ?? "lead"}→${e.to}`).toSorted();

describe("the star chart of the Chrome redesign graph", () => {
  const chart = starChart(chromeTasks);

  test("puts each leaf in the wave of its longest upstream path; parents are not stars", () => {
    expect(wavesOf(chart)).toEqual({
      F1: 1,
      F2: 1,
      F3: 1,
      F4: 1,
      F5: 1,
      D1: 1,
      V1: 2,
      V2: 2,
      V3: 2,
      V4: 2,
      V5: 2,
      V6: 2,
      B1: 2,
      B2: 3,
      B3: 3,
      B4: 3,
      Q1: 4,
      G: 5,
    });
  });

  test("gives each top-level parent and each group a band, in declaration order", () => {
    expect(chart.bands.map((b) => [b.badge, b.name])).toEqual([
      ["F", "Foundations"],
      [null, "Daemon"],
      ["V", "Views"],
      [null, "Release"],
      ["B", "Break-UI reviews"],
    ]);
  });

  test("floats the gate where its input sits, in the last column", () => {
    const gate = star(chart, "G");

    expect(gate.band).toBeNull();
    expect(gate.y).toBe(star(chart, "Q1").y);
    expect(gate.x).toBe(CHART.lastX);
  });

  test("draws the Lead to every first-wave star and nothing else", () => {
    expect(
      chart.edges
        .filter((e) => e.from === null)
        .map((e) => e.to)
        .toSorted()
    ).toEqual(["D1", "F1", "F2", "F3", "F4", "F5"]);
  });
});

const graphs: ReadonlyArray<readonly [string, ReadonlyArray<ChartTask>]> = [
  ["Chrome redesign", chromeTasks],
  ["C1", c1Record().constellation.tasks],
  ["C8, 128 Tasks", largeRecord().constellation.tasks],
];

describe.each(graphs)("the %s graph", (_, tasks) => {
  const chart = starChart(tasks);

  test("never draws two stars on the same spot", () => {
    for (const a of chart.stars)
      for (const b of chart.stars)
        if (a !== b && a.x === b.x) expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(CHART.row);
  });

  test("keeps each star inside its band and every band below the last", () => {
    for (const s of chart.stars) {
      const band = chart.bands.find((b) => b.key === s.band);

      if (band === undefined) continue;
      expect(s.y).toBeGreaterThan(band.y);
      expect(s.y).toBeLessThan(band.y + band.height);
    }

    chart.bands.forEach((b, n) => {
      const next = chart.bands[n + 1];

      if (next !== undefined) expect(next.y).toBe(b.y + b.height);
    });
  });

  test("points every edge forward, from an earlier wave to a later one", () => {
    const wave = wavesOf(chart);

    for (const e of chart.edges)
      if (e.from !== null) expect(wave[e.from] ?? 0).toBeLessThan(wave[e.to] ?? 0);
  });

  test("fits every star inside the hero", () => {
    for (const s of chart.stars) {
      expect(s.x).toBeLessThanOrEqual(chart.width);
      expect(s.y).toBeLessThan(chart.height);
    }
  });
});

describe("the layout", () => {
  test("nests deeper parents into their top-level parent's band", () => {
    const chart = starChart(largeRecord().constellation.tasks);

    expect(star(chart, "U1a").band).toBe("parent:U");
    expect(chart.bands.some((b) => b.badge === "U1")).toBe(false);
  });

  test("a dependency on a parent waits on where its work ends, not on every child", () => {
    const chart = starChart([
      t("P"),
      t("P1", { parent: "P" }),
      t("P2", { parent: "P", deps: ["P1"] }),
      t("X", { deps: ["P"] }),
    ]);

    expect(edgesOf(chart)).toEqual(["P1→P2", "P2→X", "lead→P1"]);
    expect(star(chart, "X").wave).toBe(3);
  });

  test("a child inherits its parent's dependencies", () => {
    const chart = starChart([t("A"), t("P", { deps: ["A"] }), t("P1", { parent: "P" })]);

    expect(edgesOf(chart)).toEqual(["A→P1", "lead→A"]);
  });

  test("leaves canceled Tasks off, and a parent whose children are all canceled is a star", () => {
    const chart = starChart([
      t("P"),
      t("P1", { parent: "P", canceled: true }),
      t("Y", { canceled: true }),
    ]);

    expect(chart.stars.map((s) => s.id)).toEqual(["P"]);
  });

  test("survives a cycle with finite waves", () => {
    const chart = starChart([
      t("A", { deps: ["B"] }),
      t("B", { deps: ["A"] }),
      t("C", { deps: ["A"] }),
    ]);

    expect(chart.stars).toHaveLength(3);
    expect(Math.max(...chart.stars.map((s) => s.wave))).toBeLessThanOrEqual(3);
  });

  test("orders a column by where its upstream sits, so edges don't cross", () => {
    const chart = starChart([
      t("A", { group: "g" }),
      t("B", { group: "g" }),
      t("C", { group: "g", deps: ["B"] }),
      t("D", { group: "g", deps: ["A"] }),
    ]);

    expect(star(chart, "A").y).toBeLessThan(star(chart, "B").y);
    expect(star(chart, "D").y).toBeLessThan(star(chart, "C").y);
  });

  test("grows with the rows it needs", () => {
    const one = starChart([t("A"), t("B", { deps: ["A"] })]);
    const three = starChart([t("A"), t("B"), t("C")]);

    expect(three.height - one.height).toBe(2 * CHART.row);
  });

  test("spreads a floating gate's neighbour off it in the same column", () => {
    const chart = starChart([
      t("A"),
      t("G1", { kind: "gate", deps: ["A"] }),
      t("G2", { kind: "gate", deps: ["A"] }),
    ]);

    expect(Math.abs(star(chart, "G1").y - star(chart, "G2").y)).toBe(CHART.row);
  });
});
