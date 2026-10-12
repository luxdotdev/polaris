/**
 * A Claude Code-shaped context breakdown for the bench Harness (`contextBreakdown` in a
 * script), so the Session context card's rows can be shown from a real Daemon.
 */
import {
  ContextCategory,
  ContextEntry,
  ContextSkills,
  McpServerUsage,
  MemoryFile,
  MessageUsage,
} from "@polaris/protocol";
import type { ContextBreakdown } from "../HarnessDriver.ts";

const RESERVE = 33_000;

const LOADED = [
  new McpServerUsage({
    name: "linear",
    tools: 76,
    loadedTools: 4,
    tokens: 3_100,
    deferredTokens: 41_000,
  }),
  new McpServerUsage({
    name: "paper",
    tools: 36,
    loadedTools: 2,
    tokens: 1_300,
    deferredTokens: 19_000,
  }),
];

/** Thirteen servers whose 628 tools load on demand. */
const WAITING = Array.from(
  { length: 13 },
  (_, i) =>
    new McpServerUsage({
      name: `server-${i + 1}`,
      tools: i < 4 ? 49 : 48,
      loadedTools: 0,
      tokens: 0,
      deferredTokens: 30_000,
    })
);

const SKILLS = Array.from(
  { length: 20 },
  (_, i) =>
    new ContextEntry({ name: `skill-${i + 1}`, source: "userSettings", tokens: 400 - i * 10 })
);

const FIXED = {
  system: 106,
  tools: 14_600,
  instructions: 3_400,
  mcp: 4_400,
  skills: 7_100,
  memory: 4_300,
  agents: 100,
};

const fixedTotal = Object.values(FIXED).reduce((n, t) => n + t, 0);

/** The window at `used` tokens: the fixed parts as one Claude Code session had them, the rest messages. */
export const benchBreakdown = (used: number, window: number): ContextBreakdown => {
  const messages = Math.max(0, used - fixedTotal);
  const free = Math.max(0, window - fixedTotal - messages - RESERVE);

  const usedCategory = (name: string, tokens: number) =>
    new ContextCategory({ name, kind: "used", tokens });

  return {
    categories: [
      usedCategory("System prompt", FIXED.system),
      usedCategory("System tools", FIXED.tools),
      usedCategory("MCP server instructions", FIXED.instructions),
      usedCategory("MCP tools", FIXED.mcp),
      usedCategory("Custom agents", FIXED.agents),
      usedCategory("Memory files", FIXED.memory),
      usedCategory("Skills", FIXED.skills),
      usedCategory("Messages", messages),
      new ContextCategory({ name: "Free space", kind: "free", tokens: free }),
      new ContextCategory({ name: "Autocompact buffer", kind: "buffer", tokens: RESERVE }),
    ],
    memoryFiles: [
      new MemoryFile({ path: "/home/dev/.claude/CLAUDE.md", source: "User", tokens: 400 }),
      new MemoryFile({ path: "/repo/AGENTS.md", source: "Project", tokens: 3_897 }),
      new MemoryFile({ path: "/repo/CLAUDE.md", source: "Project", tokens: 3 }),
    ],
    countedTokens: fixedTotal + messages,
    autoCompact: true,
    autoCompactAt: window - RESERVE,
    mcpServers: [...LOADED, ...WAITING],
    skills: new ContextSkills({ total: 78, included: 78, tokens: FIXED.skills, top: SKILLS }),
    agents: [
      new ContextEntry({ name: "reviewer", source: "projectSettings", tokens: FIXED.agents }),
    ],
    messages: new MessageUsage({
      toolCalls: Math.round(messages * 0.093),
      toolResults: Math.round(messages * 0.68),
      replies: Math.round(messages * 0.143),
      userMessages: Math.round(messages * 0.034),
      attachments: Math.round(messages * 0.045),
      other: 0,
    }),
  };
};
