/**
 * The SDK options of a read-only session (the Reviewer): `dontAsk`, no user or
 * project settings, hooks or MCP servers, no tool that writes or reaches the network,
 * and reads kept to the checkout. See docs/adr/0042-reviewer-without-the-sandbox.md
 * and docs/adr/0055-the-reviewer-reads-only-its-checkout.md.
 */
import type { HookCallback, Options } from "@anthropic-ai/claude-agent-sdk";
import { isAbsolute } from "node:path";
import { Option, Schema } from "effect";
import { confined, type ReadConfinement } from "../confinement.ts";
import type { ClaudeSandbox } from "./sandbox.ts";

const NEVER = ["Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch"];

const ToolPaths = Schema.Struct({
  file_path: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
  pattern: Schema.optionalKey(Schema.String),
  glob: Schema.optionalKey(Schema.String),
});

const decodeToolPaths = Schema.decodeUnknownOption(ToolPaths);

const GLOB_CHARACTER = /[*?[\]{}]/;

const climbs = (pattern: string) => pattern.split(/[\\/]/).includes("..");

/** A glob's directory part, before its first wildcard. */
const staticPrefix = (pattern: string) => {
  const parts = pattern.split("/");
  const wild = parts.findIndex((part) => GLOB_CHARACTER.test(part));
  const prefix = (wild === -1 ? parts : parts.slice(0, wild)).join("/");

  if (prefix !== "") return prefix;

  return isAbsolute(pattern) ? "/" : ".";
};

/** Whether a file tool's call reads only inside `root`; any other tool is refused. */
const readsInside = async (
  root: string,
  toolName: string,
  { file_path, path, pattern, glob }: typeof ToolPaths.Type
): Promise<boolean> => {
  const base = path ?? root;

  if (toolName === "Read") return file_path !== undefined && confined(root, root, file_path);

  if (!(await confined(root, root, base))) return false;

  if (toolName === "Glob")
    return pattern !== undefined && !climbs(pattern) && confined(root, base, staticPrefix(pattern));

  if (toolName === "Grep") return glob === undefined || (!climbs(glob) && !isAbsolute(glob));

  return false;
};

const FILE_TOOLS = "Read|Glob|Grep";

/** Polaris's own check before Claude Code's: a file tool that would leave the checkout is denied. */
export const checkoutHook =
  (root: string): HookCallback =>
  async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};

    const paths = decodeToolPaths(input.tool_input);

    if (Option.isSome(paths) && (await readsInside(root, input.tool_name, paths.value))) return {};

    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `The reviewer only reads files inside ${root}.`,
      },
    };
  };

/** File reads are allowed by path, never by tool name, so Claude Code refuses the rest. */
const base = (confinement: ReadConfinement) =>
  ({
    permissionMode: "dontAsk",
    settingSources: [],
    settings: { disableAllHooks: true },
    mcpServers: {},
    strictMcpConfig: true,
    additionalDirectories: [],
    allowedTools: [`Read(/${confinement.root}/**)`, "Agent"],
    hooks: { PreToolUse: [{ matcher: FILE_TOOLS, hooks: [checkoutHook(confinement.root)] }] },
  }) satisfies Partial<Options>;

/**
 * Bash runs in Claude Code's sandbox with no network (an empty strict allowlist), no
 * writes, and no reads of home or Polaris's state outside the checkout. If the sandbox
 * can't start, the session fails.
 */
export const sandboxedReadOnly = (confinement: ReadConfinement) =>
  ({
    ...base(confinement),
    tools: ["Read", "Glob", "Grep", "Bash", "Agent"],
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      excludedCommands: [],
      filesystem: {
        denyWrite: ["/"],
        denyRead: [...confinement.denied],
        allowRead: [confinement.root, ...confinement.shellRoots],
      },
      network: {
        allowedDomains: [],
        deniedDomains: ["*"],
        strictAllowlist: true,
        allowLocalBinding: false,
        allowAllUnixSockets: false,
      },
    },
    disallowedTools: NEVER,
  }) satisfies Partial<Options>;

/** Without the sandbox there is no shell at all: only tools that read. */
export const unsandboxedReadOnly = (confinement: ReadConfinement) =>
  ({
    ...base(confinement),
    tools: ["Read", "Glob", "Grep", "Agent"],
    sandbox: { enabled: false },
    disallowedTools: [...NEVER, "Bash"],
  }) satisfies Partial<Options>;

export const readOnlyOptions = (
  sandbox: ClaudeSandbox,
  confinement: ReadConfinement
): Partial<Options> =>
  sandbox.available ? sandboxedReadOnly(confinement) : unsandboxedReadOnly(confinement);
