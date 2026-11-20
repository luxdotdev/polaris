import { createSdkMcpServer, tool, type Options } from "@anthropic-ai/claude-agent-sdk";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Schema } from "effect";
import type { BoundTool } from "../../mcp/tools.ts";
import { z } from "zod";
import type { ConstellationAttachment } from "../constellation/attachment.ts";
import { polarisInstructions } from "../../constellation/skills/preamble.ts";

/** The SDK supplies cancellation in its handler context. */
const HandlerContext = Schema.Struct({
  signal: Schema.optionalKey(Schema.instanceOf(AbortSignal)),
});

export const callClaudeTool = (
  bound: BoundTool,
  input: Schema.Json,
  extra: typeof HandlerContext.Type
) => bound.call(input, extra.signal);

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

      const server = createSdkMcpServer({
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
            async (input, extra) => ({
              ...(await callClaudeTool(
                bound,
                Schema.decodeUnknownSync(Schema.Json)(input),
                Schema.decodeUnknownSync(HandlerContext)(extra)
              )),
            }),
            bound.annotations === undefined ? undefined : { annotations: bound.annotations }
          );
        }),
      });

      if (attachment.listTools !== undefined) {
        const listTools = attachment.listTools;
        server.instance.server.setRequestHandler(ListToolsRequestSchema, async () => ({
          tools: (await listTools()).map(({ name, description, inputSchema, annotations }) => ({
            name,
            description,
            inputSchema,
            annotations,
          })),
        }));
        server.instance.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
          const bound = (await listTools()).find((entry) => entry.name === request.params.name);

          if (bound === undefined)
            return {
              isError: true,
              content: [{ type: "text", text: "This binding has no such tool" }],
            };

          return {
            ...(await callClaudeTool(
              bound,
              Schema.decodeUnknownSync(Schema.Json)(request.params.arguments ?? {}),
              Schema.decodeUnknownSync(HandlerContext)(extra)
            )),
          };
        });
      }

      return [name, server];
    })
  ),
});
