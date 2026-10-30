import { TurnItem } from "@polaris/protocol";
import { VISUALIZATION_EXAMPLES } from "@polaris/visualization/examples";
import { describe, expect, test } from "bun:test";
import { completedItemView, type ItemView, liveItemView } from "../items.ts";
import { groupItems } from "../runs.ts";
import { polarisToolView } from "./index.ts";
import { revisedAmong, type VisualizationView, visualizationView } from "./visualization.ts";

const example = VISUALIZATION_EXAMPLES["loan-calculator"];

const drawn = (id: string, title: string) => JSON.stringify({ id, title, bytes: 10 });

const call = (
  id: string,
  options: {
    readonly status?: "completed" | "failed" | "running";
    readonly input?: Record<string, string>;
    readonly output?: unknown;
    readonly name?: string;
  } = {}
) =>
  TurnItem.cases.ToolCall.make({
    id,
    name: options.name ?? "mcp__polaris__visualize",
    kind: "mcp",
    mcp: { server: "polaris", tool: "visualize" },
    input: options.input ?? { title: example.title, html: example.html },
    output: options.output ?? [{ type: "text", text: drawn(`viz_${id}`, example.title) }],
    status: options.status ?? "completed",
  });

const read = (id: string): ItemView =>
  completedItemView(
    TurnItem.cases.ToolCall.make({
      id,
      name: "Read",
      kind: "read",
      mcp: null,
      input: { file_path: `${id}.ts` },
      output: null,
      status: "completed",
    })
  );

describe("the visualize call", () => {
  test("drawing while it runs, with the title it has so far", () => {
    expect(visualizationView(call("a", { status: "running", input: { title: "Loan" } }))).toEqual({
      phase: "drawing",
      title: "Loan",
      startedAt: null,
    });
  });

  test("shown under the id Polaris minted, not the Tool Call's", () => {
    const view = visualizationView(call("a"));

    expect(view?.phase === "shown" ? view.id : null).toBe("viz_a");
  });

  test.each([
    ["refused by Polaris", { output: "E-VISUAL-STORE: The Visualization couldn't be recorded" }],
    ["failed in the Harness", { status: "failed" as const, output: null }],
  ])("%s, it shows no Visualization and keeps its Polaris row", (_, options) => {
    const item = call("a", options);

    expect(visualizationView(item)).toBeNull();
    expect(polarisToolView(item)?.phase).toBe("refused");
    expect(polarisToolView(item)?.verb).toBe("Didn't draw a visualization");
  });

  test("Codex's name for it is recognised too", () => {
    expect(visualizationView(call("a", { name: "polaris.visualize" }))?.phase).toBe("shown");
  });
});

describe("a Visualization in a run of calls", () => {
  test("is never folded into a Tool Run: the calls before and after fold on their own", () => {
    const entries = groupItems([
      read("r1"),
      read("r2"),
      completedItemView(call("v")),
      read("r3"),
      read("r4"),
    ]);

    expect(entries.map((e) => (e.kind === "item" ? e.item.id : e.kind))).toEqual([
      "run",
      "v",
      "run",
    ]);
  });

  test("is never folded while drawing either", () => {
    const live = liveItemView("v", {
      item: call("v", { status: "running" }),
      text: "",
      output: "",
    });

    const entries = groupItems([read("r1"), read("r2"), live]);

    expect(entries.at(-1)).toEqual({ kind: "item", item: live });
  });
});

describe("revised below", () => {
  const shown = (id: string, replaces?: string): VisualizationView => ({
    phase: "shown",
    id,
    title: id,
    html: "<p></p>",
    replaces: replaces ?? null,
  });

  test("a later call naming an earlier one's id revises it", () => {
    expect([...revisedAmong([shown("v1"), shown("v2", "v1"), shown("v3")])]).toEqual(["v1"]);
  });

  test("a chain revises every one but the last", () => {
    expect([...revisedAmong([shown("v1"), shown("v2", "v1"), shown("v3", "v2")])]).toEqual([
      "v1",
      "v2",
    ]);
  });

  test("an earlier call can't revise a later one, and an unknown id revises nothing", () => {
    expect([...revisedAmong([shown("v2", "v1"), shown("v1"), shown("v3", "nope")])]).toEqual([]);
  });
});
