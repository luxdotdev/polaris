import { createSdkMcpServer, tool, type Options } from "@anthropic-ai/claude-agent-sdk";
import { Schema } from "effect";
import { z } from "zod";
import type { ConstellationAttachment } from "../constellation/attachment.ts";

export const claudeConstellationOptions = (
  attachment: ConstellationAttachment
): Partial<Options> => ({
  systemPrompt: { type: "preset", preset: "claude_code", append: attachment.instructions },
  strictMcpConfig: true,
  allowedTools: ["mcp__polaris__*"],
  mcpServers: {
    polaris: createSdkMcpServer({
      name: "polaris",
      version: "1",
      tools: attachment.tools.map((bound) => {
        const schema = z.fromJSONSchema(bound.inputSchema);

        if (!(schema instanceof z.ZodObject))
          throw new Error("Polaris tool input must be an object");

        return tool(bound.name, bound.description, schema.shape, async (input) => ({
          ...(await bound.call(Schema.decodeUnknownSync(Schema.Json)(input))),
        }));
      }),
    }),
  },
});
