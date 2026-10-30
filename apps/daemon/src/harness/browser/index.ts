/**
 * The Browser's MCP server for an Agent Session (ADR 0092): `agent-browser mcp` over stdio,
 * attached to the session's CDP relay. Claude Code and Codex sessions get it; read-only ones don't.
 */
import type { SessionId } from "@polaris/protocol";
import { Cause, Context, Effect, Layer } from "effect";
import { CdpRelay } from "../../browser/cdpRelay.ts";
import { AgentBrowser, type InstalledAgentBrowser } from "../../install/agentBrowser/index.ts";

/** Not `browser`: a user's own server of that name would shadow or be shadowed by it. */
export const BROWSER_MCP_NAME = "polaris_browser";

/** Claude Code's env var holding the relay URL; its MCP config names it, never the URL. */
export const BROWSER_CDP_ENV = "POLARIS_BROWSER_CDP";

/** Shut a session's agent-browser daemon down after 10 idle minutes; attached ones never would. */
const IDLE_TIMEOUT_MS = "600000";

export interface BrowserMcpServer {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  /** Everything the server needs but the relay URL; nothing here is secret. */
  readonly env: Readonly<Record<string, string>>;
  /** The relay URL, read by agent-browser as `AGENT_BROWSER_CDP`. Secret: never argv or logs. */
  readonly cdpUrl: string;
}

/**
 * The `core` tools profile, pinned rather than left to agent-browser's default: navigation,
 * snapshots, clicks and typing, waits, reads, screenshots, eval and tabs (29 tools in 0.41.0).
 */
export const agentBrowserServer = (
  installed: InstalledAgentBrowser,
  sessionId: SessionId,
  cdpUrl: string
): BrowserMcpServer => ({
  command: installed.binary,
  args: ["mcp", "--tools", "core"],
  env: {
    AGENT_BROWSER_CONFIG: installed.config,
    AGENT_BROWSER_SESSION: `polaris-${sessionId}`,
    AGENT_BROWSER_IDLE_TIMEOUT_MS: IDLE_TIMEOUT_MS,
  },
  cdpUrl,
});

/** Hides a relay token that a cause's message may carry. */
export const redactRelayUrls = (text: string): string =>
  text.replaceAll(/(\/browser\/[^/\s]+\/)[^\s"'/]+/g, "$1<redacted>");

export class BrowserMcp extends Context.Service<
  BrowserMcp,
  {
    /** The session's server, or null when the relay or the binary isn't there: never a failure. */
    readonly forSession: (sessionId: SessionId) => Effect.Effect<BrowserMcpServer | null>;
  }
>()("polaris/daemon/harness/BrowserMcp") {
  static readonly layer = Layer.effect(
    BrowserMcp,
    Effect.gen(function* () {
      const relay = yield* CdpRelay;
      const agentBrowser = yield* AgentBrowser;

      return BrowserMcp.of({
        forSession: (sessionId) =>
          Effect.gen(function* () {
            const { url } = yield* relay.issue(sessionId);
            const installed = yield* agentBrowser.ensure;

            return agentBrowserServer(installed, sessionId, url);
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.as(
                Effect.logWarning(
                  `session ${sessionId}: no Browser tools: ${redactRelayUrls(String(Cause.squash(cause)))}`
                ),
                null
              )
            ),
            Effect.withSpan("BrowserMcp.forSession")
          ),
      });
    })
  );

  static readonly none = Layer.succeed(BrowserMcp)(
    BrowserMcp.of({ forSession: () => Effect.succeed(null) })
  );
}
