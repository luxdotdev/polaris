import { describe, expect, test } from "bun:test";
import type { ItemView } from "./items.ts";
import { type Entry, groupItems, runKind, runSummary, toolVerb } from "./runs.ts";

const tool = (
  id: string,
  name: string,
  status: "completed" | "failed" | "running" = "completed"
): ItemView => ({
  kind: "tool",
  id,
  live: status === "running",
  name,
  summary: `${id}.ts`,
  status,
});

const command = (id: string, exitCode: number | null = 0): ItemView => ({
  kind: "command",
  id,
  live: false,
  command: "bun test",
  output: "",
  exitCode,
  status: exitCode === 0 ? "completed" : "failed",
});

const edit = (id: string, paths: ReadonlyArray<string>): ItemView => ({
  kind: "files",
  id,
  live: false,
  changes: paths.map((path) => ({ path, kind: "modify" as const })),
  status: "completed",
});

const message = (id: string): ItemView => ({ kind: "message", id, live: false, text: "ok" });

const label = (entry: Entry) => {
  switch (entry.kind) {
    case "run":
      return `run:${entry.items.length}`;
    case "item":
      return entry.item.id;
    case "subagent":
      return entry.card.id;
  }
};

describe("tool runs", () => {
  test("consecutive successful calls fold into one summary in a fixed phrase order", () => {
    const items = [
      command("c1"),
      tool("r1", "Read"),
      tool("g1", "Grep"),
      tool("r2", "Read"),
      edit("e1", ["a.ts", "b.ts"]),
      edit("e2", ["a.ts"]),
    ];

    expect(groupItems(items)).toEqual([
      {
        kind: "run",
        id: "c1",
        items,
        summary: "Read 2 files, searched for 1 pattern, edited 2 files, ran 1 command",
      },
    ]);
  });

  test("prose, failures and running calls break a run; a lone call keeps its row", () => {
    const entries = groupItems([
      tool("r1", "Read"),
      tool("r2", "Read"),
      message("m1"),
      tool("r3", "Read"),
      command("c1", 1),
      tool("r4", "Read"),
      tool("r5", "Read", "running"),
    ]);

    expect(entries.map(label)).toEqual(["run:2", "m1", "r3", "c1", "r4", "r5"]);
  });

  test("only known read, search and fetch tools join; others keep their rows", () => {
    expect(runKind(tool("x", "WebFetch"))).toBe("fetch");
    expect(runKind(tool("x", "mcp__linear__get_issue"))).toBeNull();
    expect(runKind(tool("x", "Agent"))).toBeNull();
    expect(runKind(tool("x", "Read", "failed"))).toBeNull();
    expect(runSummary([tool("a", "Glob"), tool("b", "WebSearch")])).toBe(
      "Searched for 1 pattern, searched the web 1 time"
    );
  });

  test("tool rows read as verbs", () => {
    expect(toolVerb("Read", false)).toBe("Read");
    expect(toolVerb("Grep", true)).toBe("Searching");
    expect(toolVerb("mcp__linear__get_issue", false)).toBe("mcp__linear__get_issue");
  });
});
