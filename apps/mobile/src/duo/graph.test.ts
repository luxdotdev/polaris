import { describe, expect, test } from "bun:test";
import type { Route } from "../app/route.ts";
import { arrangementOf } from "./arrangement.ts";
import {
  claimLeft,
  columnLefts,
  columns,
  depths,
  foldOf,
  graphLayout,
  NODE_HEIGHT,
  NODE_WIDTH,
} from "./graph.ts";
import { postureOf } from "./posture.ts";

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

const vertical = foldOf({ x: 455.5, y: 0, width: 40, height: 669 });

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
    const layout = graphLayout(tasks, vertical);

    for (const node of layout.nodes) {
      const overlaps = node.x < division.x + division.width && node.x + NODE_WIDTH > division.x;
      expect(overlaps).toBe(false);
    }

    expect(new Set(layout.nodes.map((n) => n.x < division.x)).size).toBe(2);
  });

  test("edges run from a dependency's right edge to the dependant's left edge", () => {
    const layout = graphLayout(tasks, vertical);
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
  expect(graphLayout(tasks, vertical).width).toBeLessThanOrEqual(951);
});

describe("the fold's axis", () => {
  // Portrait-only, fully open: the division runs across the 669pt-wide display.
  const band = { x: 0, y: 455.5, width: 669, height: 40 };
  const horizontal = foldOf(band);
  const constellation: Route = { screen: "constellation", hostId: "h", constellationId: "c" };

  test("a horizontal fully-open fold keeps the rail rather than the side-by-side graph", () => {
    const posture = postureOf({
      hinge: { status: "fullyOpen", angle: 180 },
      width: 669,
      height: 951,
      divisions: [band],
    });

    expect(arrangementOf(posture, constellation).kind).toBe("single");
  });

  test("across a horizontal fold every task stays on the display and off the division", () => {
    const tall = Array.from({ length: 8 }, (_, i) => ({ id: `T${i}`, deps: [], group: "T" }));
    const layout = graphLayout([...tall, { id: "G", deps: ["T0"], group: null }], horizontal, 126);

    for (const node of layout.nodes) {
      expect(node.x + NODE_WIDTH).toBeLessThanOrEqual(669);
      expect(node.y < band.y + band.height && node.y + NODE_HEIGHT > band.y).toBe(false);
    }

    expect(layout.height).toBeGreaterThan(Math.max(...layout.nodes.map((n) => n.y + NODE_HEIGHT)));
  });

  test("the claim sits under its task inside the graph, pushed sideways only by a vertical fold", () => {
    const layout = graphLayout(tasks.slice(0, 3), horizontal);

    expect(claimLeft(layout, 20, horizontal, 374)).toBe(20);
    expect(claimLeft(graphLayout(tasks, vertical), 20, vertical, 374)).toBe(455.5 + 40 + 20);
  });

  test("more columns than fit widen the graph to its last task, for sideways scrolling", () => {
    const chain = ["C0", "C1", "C2", "C3", "C4"].map((id, i, all) => ({
      id,
      deps: i === 0 ? [] : [all[i - 1]!],
      group: null,
    }));

    const layout = graphLayout(chain, vertical);
    const last = Math.max(...layout.nodes.map((n) => n.x + NODE_WIDTH));

    expect(last).toBeGreaterThan(951);
    expect(layout.width).toBeGreaterThanOrEqual(last);
  });
});
