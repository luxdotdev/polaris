import { CommandId } from "@polaris/protocol";
import { Schema } from "effect";
import { McpBinding, sessionBinding } from "../binding.ts";
import { leadTools } from "./lead.ts";
import { workerTools } from "./worker.ts";
import { resolvers } from "./resolve.ts";
import { toolFactory, type BoundTool, type ConstellationCommands } from "./shared.ts";

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
    Lead: () => leadTools(binding, define, submit, resolvers(binding, commands), status),
    Worker: (bound) => workerTools(bound, define, submit, status),
  });
};
