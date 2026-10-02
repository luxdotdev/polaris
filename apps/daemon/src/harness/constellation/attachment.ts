import { Effect } from "effect";
import { ConstellationRejected, ConstellationFinding } from "@polaris/protocol";
import type { McpBinding } from "../../mcp/binding.ts";
import {
  constellationTools,
  errorResult,
  type BoundTool,
  type ConstellationCommands,
} from "../../mcp/tools.ts";
import { McpTokens } from "../../mcp/tokens.ts";
import { constellationInstructions } from "./skills.ts";

export interface ConstellationAttachment {
  readonly sessionId: McpBinding["sessionId"];
  readonly instructions: string;
  readonly url: string;
  readonly tools: ReadonlyArray<BoundTool>;
}

export const attachConstellation = Effect.fn("attachConstellation")(function* (
  binding: McpBinding,
  origin: string,
  commands: ConstellationCommands
) {
  const tokens = yield* McpTokens;
  const token = yield* tokens.issue(binding);

  const tools = constellationTools(binding, commands).map((tool): BoundTool => ({
    ...tool,
    call: async (input) => {
      const current = await Effect.runPromise(tokens.authenticate(token));

      if (current === null)
        return errorResult(
          new ConstellationRejected({
            findings: [
              new ConstellationFinding({
                code: "E-REVOKED",
                message: "This session's Polaris tools were revoked",
                fix: "Continue in the current Attempt or Lead session.",
              }),
            ],
            graph: null,
            revision: 0,
          })
        );

      return tool.call(input);
    },
  }));

  return {
    sessionId: binding.sessionId,
    instructions: constellationInstructions(binding),
    url: `${origin}/mcp/${token}`,
    tools,
  } satisfies ConstellationAttachment;
});
