/** The planning scene's context window, for the Session context card. */
import {
  ContextCategory,
  ContextEntry,
  ContextSkills,
  ContextUsage,
  McpServerUsage,
  MemoryFile,
  MessageUsage,
} from "@polaris/protocol";

const category = (name: string, kind: ContextCategory["kind"], tokens: number) =>
  new ContextCategory({ name, kind, tokens });

const mcp = (name: string, tools: number, loadedTools: number, tokens: number) =>
  new McpServerUsage({ name, tools, loadedTools, tokens, deferredTokens: 0 });

/** Paper X-F 02 "Session context card": Claude Code's breakdown, after one compaction. */
export const planningContext = (path: string) =>
  new ContextUsage({
    usedTokens: 124_000,
    windowTokens: 200_000,
    categories: [
      category("System prompt", "used", 4_400),
      category("System tools", "used", 14_000),
      category("MCP tools", "used", 9_900),
      category("MCP server instructions", "used", 2_000),
      category("Skills", "used", 1_100),
      category("Memory files", "used", 4_600),
      category("Messages", "used", 84_000),
      category("Free space", "free", 35_000),
      category("Autocompact buffer", "buffer", 45_000),
    ],
    memoryFiles: [
      new MemoryFile({ path: `${path}/CLAUDE.md`, source: "Project", tokens: 600 }),
      new MemoryFile({ path: `${path}/AGENTS.md`, source: "Project", tokens: 4_000 }),
    ],
    categoriesTotal: 120_000,
    autoCompact: true,
    mcpServers: [
      mcp("github", 41, 6, 3_600),
      mcp("linear", 76, 4, 2_600),
      mcp("paper", 29, 5, 2_100),
      mcp("polaris", 12, 8, 1_600),
      mcp("vercel", 212, 0, 0),
      mcp("railway", 71, 0, 0),
    ],
    skills: new ContextSkills({
      total: 14,
      included: 14,
      tokens: 1_100,
      top: [
        new ContextEntry({ name: "product-design", source: "projectSettings", tokens: 320 }),
        new ContextEntry({ name: "humanizer", source: "userSettings", tokens: 180 }),
        new ContextEntry({ name: "break-ui", source: "userSettings", tokens: 150 }),
      ],
    }),
    messages: new MessageUsage({
      toolCalls: 12_000,
      toolResults: 41_000,
      replies: 22_000,
      userMessages: 3_000,
      attachments: 5_000,
      other: 1_000,
    }),
  });
