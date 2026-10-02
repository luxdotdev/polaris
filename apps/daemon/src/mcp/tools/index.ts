import { CommandId } from "@polaris/protocol";
import { Schema } from "effect";
import { McpBinding, sessionBinding } from "../binding.ts";
import { leadTools } from "./lead.ts";
import { workerTools } from "./worker.ts";
import { resolvers } from "./resolve.ts";
import {
  toolFactory,
  rejection,
  errorResult,
  type BoundTool,
  type ConstellationCommands,
} from "./shared.ts";

export { errorResult } from "./shared.ts";

export type { BoundTool, ConstellationCommands, McpToolResult } from "./shared.ts";

export { unavailableCommands } from "./unavailable.ts";

/** E reauthorizes the authenticated session under the store lock on every command. */
export const constellationTools = (
  binding: McpBinding,
  commands: ConstellationCommands
): ReadonlyArray<BoundTool> => {
  const caller = sessionBinding(binding);
  const define = toolFactory(() => commands.status(caller, binding.constellationId, true));

  const submit = (command: Parameters<ConstellationCommands["command"]>[2]) =>
    commands.command(caller, CommandId.make(crypto.randomUUID()), command);

  const status = define(
    "status",
    "Read the graph, Claims, questions and ready Tasks. Do not poll; updates arrive as Lead Turns.",
    Schema.Struct({ json: Schema.optionalKey(Schema.Boolean) }),
    (input) => commands.status(caller, binding.constellationId, input.json ?? false),
    { json: (input) => input.json ?? false }
  );

  return McpBinding.match(binding, {
    Plain: () =>
      leadTools(binding, define, submit, resolvers(binding, commands), status).map((tool) => ({
        ...tool,
        call: (input) =>
          tool.call(input).then((result) => {
            if (
              result.structuredContent?.graph !== null ||
              result.structuredContent.revision !== 0 ||
              !result.structuredContent.findings.some((finding) => finding.code === "E-NOT-FOUND")
            )
              return result;

            return errorResult(
              rejection(
                "E-START-FIRST",
                "Start a Constellation first",
                "Call plan with start { name, workspaceId } and operations []."
              )
            );
          }),
      })),
    Lead: () => leadTools(binding, define, submit, resolvers(binding, commands), status),
    Worker: (bound) => workerTools(bound, define, submit, status),
  });
};
