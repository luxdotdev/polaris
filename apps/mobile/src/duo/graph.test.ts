import { describe, expect, test } from "bun:test";
import { columnLefts, columns, depths, graphLayout, NODE_WIDTH } from "./graph.ts";

// D9's constellation: A1, A2 → G1 → B1, B2, B3 → G2.
const tasks = [
  { id: "A1", deps: [], group: "A" },
  { id: "A2", deps: [], group: "A" },
  { id: "G1", deps: ["A1", "A2"], group: null },
  { id: "B1", deps: ["G1"], group: "B" },
  { id: "B2", deps: ["G1"], group: "B" },
  { id: "B3", deps: ["G1", "B1"], group: "B" },
  { id: "G2", deps: ["B1", "B2", "B3"], group: null },
];

const division = { x: 455.5, width: 40 };

describe("the constellation graph across the fold", () => {
  test("a task sits one column past its deepest dependency", () => {
    expect(Object.fromEntries(depths(tasks))).toEqual({
      A1: 0,
      A2: 0,
      G1: 1,
      B1: 2,
      B2: 2,
      B3: 3,
      G2: 4,
    });
  });

  test("a group shares its shallowest member's column, so B3 stacks under B1 and B2", () => {
    expect(Object.fromEntries(columns(tasks))).toEqual({
      A1: 0,
      A2: 0,
      G1: 1,
      B1: 2,
      B2: 2,
      B3: 2,
      G2: 3,
    });
  });

  test("no node sits on the division: a column that would is moved past it", () => {
    const layout = graphLayout(tasks, division);

    for (const node of layout.nodes) {
      const overlaps = node.x < division.x + division.width && node.x + NODE_WIDTH > division.x;
      expect(overlaps).toBe(false);
    }

    expect(new Set(layout.nodes.map((n) => n.x < division.x)).size).toBe(2);
  });

  test("edges run from a dependency's right edge to the dependant's left edge", () => {
    const layout = graphLayout(tasks, division);
    const g1 = layout.nodes.find((n) => n.id === "G1");
    const edge = layout.edges.find((e) => e.from === "A2" && e.to === "G1");

    expect(edge?.x2).toBe(g1?.x);
    expect(edge?.x1).toBeLessThan(edge?.x2 ?? 0);
    expect(layout.edges).toHaveLength(9);
  });

  test("a dependency cycle or a missing task doesn't hang or misplace the graph", () => {
    const odd = [
      { id: "X", deps: ["Y", "gone"], group: null },
      { id: "Y", deps: ["X"], group: null },
    ];

    expect(depths(odd).get("X")).toBeGreaterThanOrEqual(0);
    expect(graphLayout(odd, null).edges.every((e) => e.from !== "gone")).toBe(true);
  });

  test("without a division, columns run on at a steady pitch", () => {
    const lefts = columnLefts(3, null);

    expect(lefts[2]! - lefts[1]!).toBe(lefts[1]! - lefts[0]!);
  });
});

test("D9's four columns fit the Duo's 951pt inner display without scrolling", () => {
  expect(graphLayout(tasks, division).width).toBeLessThanOrEqual(951);
});
