/**
 * The Constellation tools for an ACP session: each attachment's per-Host loopback MCP goes into
 * `mcpServers` as an `http` server, and its instructions into the first Turn's context block.
 */
import { harnessEntry } from "@polaris/protocol";
import { Effect } from "effect";
import {
  polarisContextWithoutTools,
  polarisInstructions,
  sessionAttachments,
} from "../../constellation/skills/preamble.ts";
import { HarnessError, type OpenOptions } from "../HarnessDriver.ts";
import type { AgentConnection } from "./AgentConnection.ts";
import type { AcpHarness } from "./harnesses.ts";
import type * as P from "./protocol.ts";

export interface AcpConstellation {
  readonly mcpServers: ReadonlyArray<P.McpServer>;
  /** The context block the first Turn after start or resume carries. */
  readonly context: string;
}

const withoutTools: AcpConstellation = { mcpServers: [], context: polarisContextWithoutTools() };

export const acpConstellation = (
  conn: AgentConnection,
  harness: AcpHarness,
  options: OpenOptions
): Effect.Effect<AcpConstellation, HarnessError> => {
  const attachments = sessionAttachments(options);
  const name = harnessEntry(harness.kind)?.name ?? harness.kind;

  const fail = (message: string) =>
    Effect.fail(new HarnessError({ harness: harness.kind, message }));

  if (attachments.length === 0) return Effect.succeed(withoutTools);

  if (attachments.some((a) => a.sessionId !== options.sessionId))
    return fail("Constellation attachment belongs to another session");

  // The loopback MCP is HTTP; ACP agents need only stdio, so HTTP is a capability they declare.
  if (conn.initialize.agentCapabilities?.mcpCapabilities?.http !== true)
    return attachments.every((a) => a.role === "Plain")
      ? Effect.succeed(withoutTools)
      : fail(
          `${name} doesn't accept HTTP MCP servers, so it can't get this session's Polaris tools. Choose Codex or Claude Code for it.`
        );

  return Effect.succeed({
    mcpServers: attachments.map((a, index) => ({
      type: "http" as const,
      name: `polaris${index === 0 ? "" : `_${index}`}`,
      url: a.url,
      headers: [],
    })),
    context: polarisInstructions({ constellations: attachments }),
  });
};
