/** The Polaris MCP servers of a Codex thread, as `thread/start`'s `config` names them. */
import { SECRET_REQUEST_MAX_TIMEOUT_MS } from "@polaris/protocol";
import type { ConstellationAttachment } from "../constellation/attachment.ts";

/** Above Codex's 60 s default, so a Secret Request can wait its full hour (ADR 0089). */
export const POLARIS_TOOL_TIMEOUT_SECONDS = SECRET_REQUEST_MAX_TIMEOUT_MS / 1000 + 60;

/** One server's config; `visualize` and `verdict` run unasked under every policy, plan included. */
const polarisServer = (attachment: ConstellationAttachment) => {
  const server = { url: attachment.url, tool_timeout_sec: POLARIS_TOOL_TIMEOUT_SECONDS };
  const unasked = attachment.tools.filter((t) => t.name === "visualize" || t.name === "verdict");

  return unasked.length === 0
    ? server
    : {
        ...server,
        tools: Object.fromEntries(unasked.map((t) => [t.name, { approval_mode: "approve" }])),
      };
};

type Servers = ReadonlyArray<readonly [name: string, server: ReturnType<typeof polarisServer>]>;

/** Each attachment's server by name: `polaris`, then `polaris_1`… */
export const polarisServers = (attachments: ReadonlyArray<ConstellationAttachment>): Servers =>
  attachments.map((a, index) => [`polaris${index === 0 ? "" : `_${index}`}`, polarisServer(a)]);

/** An ordinary thread's servers, beside whatever the user configured. */
export const besideUserServers = (servers: Servers) =>
  Object.fromEntries(servers.map(([name, server]) => [`mcp_servers.${name}`, server]));

/** The read-only profile turns every configured server off; an Inspector's goes in beside them. */
export const insideProfile = <C extends { readonly mcp_servers: object }>(
  profile: C,
  servers: Servers
) => ({ ...profile, mcp_servers: { ...profile.mcp_servers, ...Object.fromEntries(servers) } });
