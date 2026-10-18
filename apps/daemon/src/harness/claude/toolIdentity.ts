import type { McpTool, ToolKind } from "@polaris/protocol";

/** Claude Code's built-in tools that a Tool Run counts; anything else is `other`. */
const KINDS = new Map<string, ToolKind>([
  ["Read", "read"],
  ["NotebookRead", "read"],
  ["LS", "read"],
  ["Grep", "search"],
  ["Glob", "search"],
  ["WebFetch", "fetch"],
  ["WebSearch", "web-search"],
  ["Skill", "skill"],
]);

/**
 * The server and tool of an MCP tool name, `mcp__<server>__<tool>`; null for any other.
 * Servers may hold single underscores (`claude_ai_Linear`), so the first `__` ends the server.
 */
export const mcpTool = (name: string): McpTool | null => {
  if (!name.startsWith("mcp__")) return null;
  const rest = name.slice("mcp__".length);
  const split = rest.indexOf("__");

  if (split <= 0 || split + 2 >= rest.length) return null;

  return { server: rest.slice(0, split), tool: rest.slice(split + 2) };
};

/** A Claude Code tool's kind and MCP identity, from its name. */
export const toolIdentity = (name: string) => {
  const mcp = mcpTool(name);
  const kind: ToolKind = mcp === null ? (KINDS.get(name) ?? "other") : "mcp";

  return { kind, mcp };
};
