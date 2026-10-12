import { describe, expect, test } from "bun:test";
import { detailsOf } from "./contextDetails.ts";

const server = (name: string, tools: number, loadedTools: number, tokens: number) => ({
  name,
  tools,
  loadedTools,
  tokens,
  deferredTokens: 0,
});

const usage = {
  usedTokens: 124_000,
  windowTokens: 200_000,
  categories: [{ name: "MCP server instructions", kind: "used" as const, tokens: 3_400 }],
  memoryFiles: [
    { path: "/repo/CLAUDE.md", source: "Project", tokens: 3 },
    { path: "/repo/AGENTS.md", source: "Project", tokens: 2_900 },
  ],
  categoriesTotal: 124_000,
  autoCompact: true,
  autoCompactAt: 155_000,
  mcpServers: [
    server("linear", 76, 4, 3_100),
    server("paper", 36, 2, 1_300),
    server("figma", 400, 0, 0),
    server("vercel", 228, 0, 0),
  ],
  skills: {
    total: 78,
    included: 78,
    tokens: 7_100,
    top: [
      { name: "product-design", source: "projectSettings", tokens: 400 },
      { name: "effect", source: "userSettings", tokens: 300 },
    ],
  },
  agents: [],
  messages: {
    toolCalls: 8_400,
    toolResults: 61_200,
    replies: 12_900,
    userMessages: 3_100,
    attachments: 4_000,
    other: 400,
  },
};

describe("detailsOf", () => {
  test("conversation: by kind, largest first, attachments with the rest", () => {
    expect(detailsOf(usage, "conversation").rows.map((r) => [r.label, r.tokens])).toEqual([
      ["Tool results", 61_200],
      ["Replies", 12_900],
      ["Tool calls", 8_400],
      ["Attachments and reminders", 4_400],
      ["Your messages", 3_100],
    ]);
  });

  test("MCP: loaded servers, the instructions, and who loads on demand", () => {
    const mcp = detailsOf(usage, "mcp");

    expect(mcp.rows.map((r) => [r.label, r.note, r.tokens])).toEqual([
      ["linear", "4 of 76 tools", 3_100],
      ["paper", "2 of 36 tools", 1_300],
      ["Server instructions", "4 servers", 3_400],
    ]);
    expect(mcp.footnote).toEqual({
      text: "2 more servers load their 628 tools on demand",
      tokens: null,
    });
  });

  test("skills: the count, the largest, and the rest together", () => {
    const skills = detailsOf(usage, "skills");

    expect(skills.count).toBe("78");
    expect(skills.rows.map((r) => r.label)).toEqual(["product-design", "effect"]);
    expect(skills.footnote).toEqual({ text: "76 more", tokens: 6_400 });
  });

  test("memory files: names, largest first", () => {
    const memory = detailsOf(usage, "memory");

    expect(memory.count).toBe("2 files");
    expect(memory.rows.map((r) => r.label)).toEqual(["AGENTS.md", "CLAUDE.md"]);
  });

  test("nothing counted, nothing to open", () => {
    const bare = { ...usage, mcpServers: [], skills: null, messages: null, memoryFiles: [] };

    for (const key of ["conversation", "mcp", "skills", "memory", "system"])
      expect(detailsOf(bare, key)).toEqual({ count: null, rows: [], footnote: null });
  });
});
