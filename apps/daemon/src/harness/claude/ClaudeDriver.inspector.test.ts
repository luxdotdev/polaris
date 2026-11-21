/** A read-only session that is an Inspector's (ADR 0119): the Reviewer's confinement, plus `verdict`. */
import { expect, test } from "bun:test";
import { SessionId } from "@polaris/protocol";
import { Effect, Exit, Scope } from "effect";
import { polarisInstructions } from "../../constellation/skills/preamble.ts";
import type { ConstellationAttachment } from "../constellation/attachment.ts";
import { makeClaudeDriver } from "./ClaudeDriver.ts";
import { FakeClaude } from "./fakeClaude.ts";

const SESSION = SessionId.make("session-1");

const bound = (name: string) => ({
  name,
  description: name,
  inputSchema: { type: "object" as const, properties: {} },
  call: async () => ({ content: [], isError: false }),
});

const worker: ConstellationAttachment = {
  sessionId: SESSION,
  instructions: "Polaris worker instructions",
  url: "http://127.0.0.1:12345/mcp/worker",
  tools: [bound("claim")],
  role: "Worker",
};

const verdict: ConstellationAttachment = {
  sessionId: SESSION,
  instructions: "You are a Polaris inspector.",
  url: "http://127.0.0.1:12345/mcp/inspector",
  tools: [bound("verdict")],
  role: "Inspector",
};

test("a read-only Inspector keeps only its verdict server: no settings or hooks from the checkout, no other tool", async () => {
  const fake = new FakeClaude();
  const scope = Effect.runSync(Scope.make());

  await Effect.runPromise(
    makeClaudeDriver({ query: fake.query, claudePath: () => "/opt/bin/claude" })
      .open({
        sessionId: SESSION,
        cwd: "/work/repo",
        permissionMode: "plan",
        model: null,
        effort: null,
        resumeCursor: null,
        readOnly: true,
        constellations: [worker, verdict],
      })
      .pipe(Scope.provide(scope))
  );

  try {
    const options = fake.options!;

    // The worker wrote the checkout: its project and local settings and hooks stay out.
    expect(options.settingSources).toEqual([]);
    expect(options.settings).toMatchObject({ disableAllHooks: true });
    expect(options.strictMcpConfig).toBe(true);
    expect(options.permissionMode).toBe("dontAsk");
    expect(Object.keys(options.mcpServers ?? {})).toEqual(["polaris"]);
    expect(options.allowedTools).toContain("mcp__polaris__verdict");
    expect(options.allowedTools?.filter((name) => name.startsWith("mcp__"))).toEqual([
      "mcp__polaris__verdict",
    ]);
    expect(options.systemPrompt).toMatchObject({
      append: polarisInstructions({ constellations: [verdict] }),
    });

    const decide = async (tool: string) => {
      const answer = await options.hooks!.PreToolUse![0]!.hooks[0]!(
        {
          hook_event_name: "PreToolUse",
          tool_name: tool,
          tool_input: {},
          tool_use_id: "t1",
          cwd: "/work/repo",
          session_id: "s",
          transcript_path: "/tmp/t",
        },
        "t1",
        { signal: new AbortController().signal }
      );

      return "hookSpecificOutput" in answer ? "deny" : "allow";
    };

    expect(await decide("mcp__polaris__verdict")).toBe("allow");
    expect(await decide("mcp__polaris__claim")).toBe("deny");
    expect(await decide("mcp__linear__save_issue")).toBe("deny");
    expect(await decide("Edit")).toBe("deny");
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }
});
