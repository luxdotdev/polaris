/**
 * The SDK options of a read-only session (the Reviewer): `dontAsk`, no user or
 * project settings, hooks or MCP servers, and no tool that writes or reaches the network.
 * See docs/adr/0039-reviewer-without-the-sandbox.md.
 */
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeSandbox } from "./sandbox.ts";

const BASE = {
  permissionMode: "dontAsk",
  settingSources: [],
  settings: { disableAllHooks: true },
  mcpServers: {},
  strictMcpConfig: true,
  allowedTools: ["Read", "Glob", "Grep", "Agent"],
} satisfies Partial<Options>;

const NEVER = ["Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch"];

/**
 * Bash runs in Claude Code's sandbox with no network (an empty strict allowlist)
 * and never outside it. If the sandbox still can't start, the session fails.
 */
export const SANDBOXED_READ_ONLY = {
  ...BASE,
  tools: ["Read", "Glob", "Grep", "Bash", "Agent"],
  sandbox: {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false,
    excludedCommands: [],
    filesystem: { denyWrite: ["/"] },
    network: {
      allowedDomains: [],
      deniedDomains: ["*"],
      strictAllowlist: true,
      allowLocalBinding: false,
      allowAllUnixSockets: false,
    },
  },
  disallowedTools: NEVER,
} satisfies Partial<Options>;

/** Without the sandbox there is no shell at all: only tools that read. */
export const UNSANDBOXED_READ_ONLY = {
  ...BASE,
  tools: ["Read", "Glob", "Grep", "Agent"],
  sandbox: { enabled: false },
  disallowedTools: [...NEVER, "Bash"],
} satisfies Partial<Options>;

export const readOnlyOptions = (sandbox: ClaudeSandbox): Partial<Options> =>
  sandbox.available ? SANDBOXED_READ_ONLY : UNSANDBOXED_READ_ONLY;
