/**
 * Claude Code's `/context` count (`getContextUsage`) as the breakdown Polaris keeps. Every
 * recorded report carries it, so long lists are summed: MCP tools per server, skills capped.
 */
import type { Query } from "@anthropic-ai/claude-agent-sdk";
import {
  ContextCategory,
  ContextEntry,
  ContextSkills,
  McpServerUsage,
  MemoryFile,
  MessageUsage,
} from "@polaris/protocol";
import type { ContextBreakdown } from "../HarnessDriver.ts";

export type ClaudeContextUsage = Awaited<ReturnType<Query["getContextUsage"]>>;

/** How many skills or agents a report names; the rest count only in the total. */
export const TOP_SKILLS = 20;

/** Claude Code estimates some counts, so they may be fractional. */
const int = (n: number) => Math.round(n);

const bySize = <T extends { readonly tokens: number }>(rows: ReadonlyArray<T>) =>
  [...rows].sort((a, b) => b.tokens - a.tokens);

/** Tools grouped by server; a tool without `isLoaded` is in the window (no tool search). */
const mcpServersOf = (tools: ClaudeContextUsage["mcpTools"]): McpServerUsage[] => {
  const servers = new Map<
    string,
    { tools: number; loaded: number; tokens: number; deferred: number }
  >();

  for (const tool of tools) {
    const server = servers.get(tool.serverName) ?? { tools: 0, loaded: 0, tokens: 0, deferred: 0 };
    const loaded = tool.isLoaded !== false;

    server.tools++;

    if (loaded) {
      server.loaded++;
      server.tokens += tool.tokens;
    } else server.deferred += tool.tokens;
    servers.set(tool.serverName, server);
  }

  // In-window tokens first; with tool search on, every server ties at 0 there.
  return [...servers]
    .map(
      ([name, s]) =>
        new McpServerUsage({
          name,
          tools: s.tools,
          loadedTools: s.loaded,
          tokens: int(s.tokens),
          deferredTokens: int(s.deferred),
        })
    )
    .sort((a, b) => b.tokens - a.tokens || b.deferredTokens - a.deferredTokens);
};

const skillsOf = (skills: ClaudeContextUsage["skills"]): ContextSkills | null =>
  skills === undefined
    ? null
    : new ContextSkills({
        total: skills.totalSkills,
        included: skills.includedSkills,
        tokens: int(skills.tokens),
        top: bySize(skills.skillFrontmatter)
          .slice(0, TOP_SKILLS)
          .map((s) => new ContextEntry({ name: s.name, source: s.source, tokens: int(s.tokens) })),
      });

const messagesOf = (m: ClaudeContextUsage["messageBreakdown"]): MessageUsage | null =>
  m === undefined
    ? null
    : new MessageUsage({
        toolCalls: int(m.toolCallTokens),
        toolResults: int(m.toolResultTokens),
        replies: int(m.assistantMessageTokens),
        userMessages: int(m.userMessageTokens),
        attachments: int(m.attachmentTokens),
        other: int(m.redirectedContextTokens + m.unattributedTokens),
      });

export const breakdownOf = (usage: ClaudeContextUsage): ContextBreakdown => ({
  categories: usage.categories.map(
    (c) => new ContextCategory({ name: c.name, kind: c.kind, tokens: int(c.tokens) })
  ),
  memoryFiles: usage.memoryFiles.map(
    (f) => new MemoryFile({ path: f.path, source: f.type, tokens: int(f.tokens) })
  ),
  countedTokens: usage.totalTokens,
  autoCompact: usage.isAutoCompactEnabled,
  autoCompactAt: usage.autoCompactThreshold === undefined ? null : int(usage.autoCompactThreshold),
  mcpServers: mcpServersOf(usage.mcpTools),
  skills: skillsOf(usage.skills),
  agents: bySize(usage.agents)
    .slice(0, TOP_SKILLS)
    .map((a) => new ContextEntry({ name: a.agentType, source: a.source, tokens: int(a.tokens) })),
  messages: messagesOf(usage.messageBreakdown),
});
