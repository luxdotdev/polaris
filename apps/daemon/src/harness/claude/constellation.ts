import { createSdkMcpServer, tool, type Options } from "@anthropic-ai/claude-agent-sdk";
import { Schema } from "effect";
import { z } from "zod";
import type { ConstellationAttachment } from "../constellation/attachment.ts";
import { polarisInstructions } from "../../constellation/skills/preamble.ts";

export const claudeConstellationOptions = (
  attachments: ReadonlyArray<ConstellationAttachment>
): Partial<Options> => ({
  systemPrompt: {
    type: "preset",
    preset: "claude_code",
    append: polarisInstructions({ constellations: attachments }),
  },
  // Plan mode ignores the wildcard rule; only a tool's exact name lets it run unasked there.
  allowedTools: attachments.flatMap((attachment, index) => {
    const server = `mcp__polaris${index === 0 ? "" : `_${index}`}`;

    return [
      `${server}__*`,
      ...attachment.tools.filter((t) => t.name === "visualize").map((t) => `${server}__${t.name}`),
    ];
  }),
  mcpServers: Object.fromEntries(
    attachments.map((attachment, index) => {
      const name = `polaris${index === 0 ? "" : `_${index}`}`;

      return [
        name,
        createSdkMcpServer({
          name,
          version: "1",
          tools: attachment.tools.map((bound) => {
            const schema = z.fromJSONSchema(bound.inputSchema);

            if (!(schema instanceof z.ZodObject))
              throw new Error("Polaris tool input must be an object");

            return tool(
              bound.name,
              bound.description,
              schema.shape,
              async (input) => ({
                ...(await bound.call(Schema.decodeUnknownSync(Schema.Json)(input))),
              }),
              bound.annotations === undefined ? undefined : { annotations: bound.annotations }
            );
          }),
        }),
      ];
    })
  ),
});
