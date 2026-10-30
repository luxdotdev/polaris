import { describe, expect, test } from "bun:test";
import { SessionId } from "@polaris/protocol";
import { Effect, Exit, Scope } from "effect";
import { agentBrowserServer, type BrowserMcp } from "../browser/index.ts";
import type { OpenOptions } from "../HarnessDriver.ts";
import { makeClaudeDriver } from "./ClaudeDriver.ts";
import { FakeClaude } from "./fakeClaude.ts";

const asked: string[] = [];

const browser: BrowserMcp["Service"] = {
  forSession: (sessionId) =>
    Effect.sync(() => {
      asked.push(sessionId);

      return agentBrowserServer("/opt/ab", sessionId, `/cfg/${sessionId}.json`);
    }),
};

const optionsOf = async (overrides: Partial<OpenOptions>) => {
  const fake = new FakeClaude();

  const driver = makeClaudeDriver({
    query: fake.query,
    claudePath: () => "/opt/bin/claude",
    stagingDir: "/tmp/polaris-staging",
    browser,
  });

  const scope = Effect.runSync(Scope.make());

  await Effect.runPromise(
    driver
      .open({
        sessionId: SessionId.make("session-1"),
        cwd: "/work/repo",
        permissionMode: "supervised",
        model: null,
        effort: null,
        resumeCursor: null,
        ...overrides,
      })
      .pipe(Scope.provide(scope))
  );
  await Effect.runPromise(Scope.close(scope, Exit.void));

  return fake.options!;
};

describe("the Browser's MCP server in Claude Code", () => {
  test("a session gets agent-browser as a stdio server", async () => {
    const o = await optionsOf({});

    expect(o.mcpServers?.["polaris_browser"]).toEqual({
      type: "stdio",
      command: "/opt/ab",
      args: ["mcp", "--tools", "core"],
      env: {
        AGENT_BROWSER_CONFIG: "/cfg/session-1.json",
        AGENT_BROWSER_SESSION: "polaris-session-1",
        AGENT_BROWSER_IDLE_TIMEOUT_MS: "600000",
      },
    });
  });

  test("its tools are not pre-allowed, beside a Constellation's", async () => {
    const attachment = {
      sessionId: SessionId.make("session-1"),
      instructions: "Polaris worker instructions",
      url: "http://127.0.0.1:12345/mcp/test",
      tools: [],
    };

    const o = await optionsOf({ constellation: attachment, permissionMode: "supervised" });

    expect(Object.keys(o.mcpServers ?? {}).toSorted()).toEqual(["polaris", "polaris_browser"]);
    expect(o.allowedTools).toEqual(["mcp__polaris__*"]);
    expect(o.permissionMode).toBe("default");
  });

  test("a read-only session gets no Browser and issues no relay URL", async () => {
    asked.length = 0;
    const o = await optionsOf({ readOnly: true });

    expect(o.mcpServers).toEqual({});
    expect(asked).toEqual([]);
  });
});
