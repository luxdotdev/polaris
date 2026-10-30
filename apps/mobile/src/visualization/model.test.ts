import { describe, expect, test } from "bun:test";
import { type SessionStreamItem, TurnItem } from "@polaris/protocol";
import { Match } from "effect";
import { FRAME_HEIGHT_MAX, FRAME_HEIGHT_MIN } from "@polaris/visualization";
import { applySessionItem, type SessionFold } from "../thread/fold.ts";
import { snapshot, turn } from "../thread/daemon.testing.ts";
import { threadRows, type ThreadRow } from "../thread/rows.ts";
import { navigationPolicy } from "./frame.ts";
import { liveVisualizations } from "./live.ts";
import { clampHeight, openableLink, parseFrameMessage, revisedIds } from "./model.ts";

type Status = "running" | "completed" | "failed" | "declined";

const claudeOutput = (id: string, title: string) => [
  { type: "text", text: JSON.stringify({ id, title, bytes: 10 }) },
];

type Output = Extract<TurnItem, { readonly _tag: "ToolCall" }>["output"];

const visualize = (
  callId: string,
  input: { title: string; html?: string; replaces?: string },
  status: Status = "completed",
  output: Output = status === "completed" ? claudeOutput(`viz_${callId}`, input.title) : null
) =>
  TurnItem.cases.ToolCall.make({
    id: callId,
    name: "mcp__polaris__visualize",
    kind: "mcp",
    mcp: { server: "polaris", tool: "visualize" },
    input: { html: "<p>hi</p>", ...input },
    output,
    status,
  });

const read = (id: string) =>
  TurnItem.cases.ToolCall.make({
    id,
    name: "Read",
    kind: "read",
    input: { file_path: `/repo/${id}.ts` },
    output: null,
    status: "completed",
  });

const foldOf = (items: ReadonlyArray<SessionStreamItem>) =>
  items.reduce<SessionFold | null>(applySessionItem, null);

const rowsOf = (items: ReadonlyArray<TurnItem>, status: "working" | "completed" = "working") =>
  threadRows(
    foldOf([
      snapshot([
        {
          turn: turn(
            0,
            status === "working" ? { prompt: "", status, endedAt: null } : { prompt: "" }
          ),
          items,
        },
      ]),
    ])?.turns ?? [],
    new Set()
  );

const line = (row: ThreadRow): string =>
  Match.value(row).pipe(
    Match.when({ kind: "visualization" }, ({ visualization }) =>
      visualization.drawing
        ? `visualization: ${visualization.title} (drawing)`
        : `visualization: ${visualization.title}`
    ),
    Match.when({ kind: "run" }, (run) => `run: ${run.summary}${run.last ? " |" : ""}`),
    Match.orElse(({ kind }) => kind)
  );

describe("a visualize call in the thread", () => {
  test("is its own card between runs, never folded into one", () => {
    const rows = rowsOf([
      read("a"),
      read("b"),
      visualize("v", { title: "Loan" }),
      read("c"),
      read("d"),
    ]);

    expect(rows.map(line)).toEqual([
      "run: Read 2 files |",
      "visualization: Loan",
      "run: Read 2 files |",
    ]);
  });

  test("draws while its call runs; a call refused or cut off by the Turn's end leaves no card", () => {
    expect(rowsOf([visualize("v", { title: "Loan" }, "running")]).map(line)).toEqual([
      "visualization: Loan (drawing)",
    ]);
    expect(rowsOf([visualize("v", { title: "Loan" }, "failed")]).map((row) => row.kind)).toEqual([
      "step",
    ]);
    expect(
      rowsOf([visualize("v", { title: "Loan" }, "running")], "completed").filter(
        (row) => row.kind === "visualization"
      )
    ).toEqual([]);
  });

  test("its id is the Daemon's, from Claude Code's and Codex's output shapes", () => {
    const codex = { content: [{ type: "text", text: '{"id":"viz_c","title":"T","bytes":1}' }] };
    const [fromClaude] = rowsOf([visualize("call-1", { title: "T" })]);
    const [fromCodex] = rowsOf([visualize("call-2", { title: "T" }, "completed", codex)]);

    expect(fromClaude?.kind === "visualization" && fromClaude.visualization.id).toBe("viz_call-1");
    expect(fromCodex?.kind === "visualization" && fromCodex.visualization.id).toBe("viz_c");
  });
});

describe("revised below", () => {
  const turns = (later: Status) => [
    { items: [visualize("a", { title: "First" })] },
    { items: [read("r"), visualize("b", { title: "Second", replaces: "viz_a" }, later)] },
  ];

  test("a later Visualization naming an earlier id, in any Turn, collapses that one", () => {
    expect([...revisedIds(turns("completed"))]).toEqual(["viz_a"]);
  });

  test("a replacement still drawing, or refused, leaves the earlier one open", () => {
    expect(revisedIds(turns("running")).size).toBe(0);
    expect(revisedIds(turns("failed")).size).toBe(0);
  });
});

describe("frame messages", () => {
  test("only the frame's three message shapes are taken", () => {
    expect(parseFrameMessage('{"type":"pv:height","height":412}')).toEqual({
      type: "pv:height",
      height: 412,
    });
    expect(parseFrameMessage('{"type":"pv:state","state":{"rate":4}}')).toEqual({
      type: "pv:state",
      state: { rate: 4 },
    });

    for (const data of ['{"type":"pv:send","text":"hi"}', '{"type":"pv:height"}', "not json"])
      expect(parseFrameMessage(data)).toBeNull();
  });

  test("a reported height is clamped to the frame's range", () => {
    expect(clampHeight(3)).toBe(FRAME_HEIGHT_MIN);
    expect(clampHeight(1e9)).toBe(FRAME_HEIGHT_MAX);
    expect(clampHeight(240.2)).toBe(241);
    expect(clampHeight(Number.NaN)).toBeNull();
  });

  test("only https links are offered, named by their domain", () => {
    expect(openableLink("https://user@Docs.Example.com:8443/a?b#c")).toEqual({
      href: "https://user@Docs.Example.com:8443/a?b#c",
      host: "docs.example.com",
    });

    for (const url of ["http://example.com", "javascript:alert(1)", "data:text/html,x", "https://"])
      expect(openableLink(url)).toBeNull();
  });
});

describe("the frame's navigation", () => {
  test("only its own document loads; anything after, or anywhere else, is refused", () => {
    const policy = navigationPolicy();

    expect(policy.shouldStart({ url: "about:blank" })).toBe(true);
    expect(policy.refused).toBe(false);
    policy.loaded();
    expect(policy.shouldStart({ url: "about:blank" })).toBe(false);
    expect(navigationPolicy().shouldStart({ url: "https://evil.example/?d=secret" })).toBe(false);
    expect(policy.refused).toBe(true);
  });
});

describe("live WebViews", () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({
    key: `r${index}`,
    kind: index % 2 === 0 ? "visualization" : "reply",
  }));

  test("go to the Visualizations nearest the screen, up to the cap", () => {
    expect([...liveVisualizations(rows, [8, 9], 3, 4)].sort()).toEqual(["r10", "r6", "r8"]);
  });

  test("none beyond reach, and none before anything is on screen", () => {
    expect([...liveVisualizations(rows, [9], 10, 1)].sort()).toEqual(["r10", "r8"]);
    expect(liveVisualizations(rows, []).size).toBe(0);
  });
});
