import { describe, expect, test } from "bun:test";
import { McpServerUsage, MessageUsage } from "@polaris/protocol";
import { breakdownOf, type ClaudeContextUsage, TOP_SKILLS } from "./context.ts";

const reply = (fields: Partial<ClaudeContextUsage>): ClaudeContextUsage => ({
  categories: [],
  totalTokens: 28_744,
  maxTokens: 200_000,
  rawMaxTokens: 200_000,
  percentage: 14,
  gridRows: [],
  model: "claude-opus-5",
  memoryFiles: [],
  mcpTools: [],
  agents: [],
  isAutoCompactEnabled: true,
  apiUsage: null,
  ...fields,
});

describe("breakdownOf", () => {
  test("MCP tools sum per server, loaded ones in the window, largest server first", () => {
    const { mcpServers } = breakdownOf(
      reply({
        mcpTools: [
          { name: "a", serverName: "paper", tokens: 400, isLoaded: false },
          { name: "b", serverName: "linear", tokens: 900, isLoaded: true },
          { name: "c", serverName: "linear", tokens: 600, isLoaded: false },
          { name: "d", serverName: "pgbot", tokens: 300.4 },
        ],
      })
    );

    expect(mcpServers).toEqual([
      new McpServerUsage({
        name: "linear",
        tools: 2,
        loadedTools: 1,
        tokens: 900,
        deferredTokens: 600,
      }),
      new McpServerUsage({
        name: "pgbot",
        tools: 1,
        loadedTools: 1,
        tokens: 300,
        deferredTokens: 0,
      }),
      new McpServerUsage({
        name: "paper",
        tools: 1,
        loadedTools: 0,
        tokens: 0,
        deferredTokens: 400,
      }),
    ]);
  });

  test("skills keep their totals and only the largest few by name", () => {
    const skillFrontmatter = Array.from({ length: 30 }, (_, i) => ({
      name: `skill-${i}`,
      source: "userSettings",
      tokens: i * 10,
    }));

    const { skills } = breakdownOf(
      reply({ skills: { totalSkills: 30, includedSkills: 30, tokens: 4350, skillFrontmatter } })
    );

    expect(skills?.total).toBe(30);
    expect(skills?.tokens).toBe(4350);
    expect(skills?.top).toHaveLength(TOP_SKILLS);
    expect(skills?.top[0]?.name).toBe("skill-29");
  });

  test("the conversation splits by what carried it; a Claude Code without it gives null", () => {
    const counted = breakdownOf(
      reply({
        autoCompactThreshold: 167_000,
        agents: [{ agentType: "code-simplifier", source: "plugin", tokens: 51 }],
        messageBreakdown: {
          toolCallTokens: 10,
          toolResultTokens: 20,
          attachmentTokens: 30,
          assistantMessageTokens: 40,
          userMessageTokens: 50,
          redirectedContextTokens: 1,
          unattributedTokens: 2,
          toolCallsByType: [],
          attachmentsByType: [],
        },
      })
    );

    expect(counted.messages).toEqual(
      new MessageUsage({
        toolCalls: 10,
        toolResults: 20,
        replies: 40,
        userMessages: 50,
        attachments: 30,
        other: 3,
      })
    );
    expect(counted.autoCompactAt).toBe(167_000);
    expect(counted.agents?.[0]?.name).toBe("code-simplifier");

    const bare = breakdownOf(reply({}));

    expect([bare.messages, bare.skills, bare.autoCompactAt]).toEqual([null, null, null]);
  });
});
