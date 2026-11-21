import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { ConstellationId, TurnId, WorkspaceId } from "@polaris/protocol";
import { Effect, Exit, Layer, Schema, Scope } from "effect";
import {
  polarisContextWithoutTools,
  polarisInstructions,
} from "../../constellation/skills/preamble.ts";
import { McpBinding } from "../../mcp/binding.ts";
import { mcpHttp } from "../../mcp/http.ts";
import { WORKER_TOOL_NAMES, fakeCommands, workerBinding } from "../../mcp/testing.ts";
import { McpTokens } from "../../mcp/tokens.ts";
import { newTempDir, removeTempDir } from "../../platform/tempDir.testing.ts";
import { attachConstellation, type ConstellationAttachment } from "../constellation/attachment.ts";
import type { HarnessSession } from "../HarnessDriver.ts";
import { makeAcpDriver } from "./AcpDriver.ts";
import { COPILOT } from "./harnesses.ts";
import type { Scenario } from "./testing/fakeAgent.ts";
import { collect, fakeBinary, type Received } from "./testing/harness.ts";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const httpMcp = {
  protocolVersion: 1,
  agentCapabilities: { mcpCapabilities: { http: true }, sessionCapabilities: { resume: {} } },
};

/** A real loopback MCP endpoint whose Constellation commands are recorded. */
const endpoint = async () => {
  const root = newTempDir("polaris-acp-mcp-", { short: true });
  const scope = Effect.runSync(Scope.make());
  const fake = fakeCommands();
  const tokens = McpTokens.layer(join(root, "tokens.sqlite"));
  const context = await Effect.runPromise(Layer.buildWithScope(tokens, scope));

  const provide = <A, E>(effect: Effect.Effect<A, E, McpTokens | Scope.Scope>) =>
    Effect.runPromise(effect.pipe(Effect.provide(context), Scope.provide(scope)));

  const { origin } = await provide(mcpHttp(fake.commands));

  cleanups.push(async () => {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    removeTempDir(root);
  });

  return {
    calls: fake.calls,
    attach: (binding: McpBinding) => provide(attachConstellation(binding, origin, fake.commands)),
  };
};

const open = async (
  scenario: Scenario,
  attachment: ConstellationAttachment,
  resumeCursor: string | null = null
) => {
  const fake = fakeBinary(scenario);
  const scope = Effect.runSync(Scope.make());

  cleanups.push(async () => {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    fake.remove();
  });

  const driver = await Effect.runPromise(
    Scope.provide(
      makeAcpDriver({ harness: COPILOT, binaryPath: () => fake.binary, listCwd: fake.dir }),
      scope
    )
  );

  const session = Effect.runPromise(
    Scope.provide(
      driver.open({
        sessionId: attachment.sessionId,
        cwd: fake.dir,
        permissionMode: "supervised",
        model: null,
        effort: null,
        resumeCursor,
        constellations: [attachment],
      }),
      scope
    )
  );

  return { fake, session };
};

/** What the fake agent's `mcp` step logged: its `tools/list` and `tools/call` answers. */
const decodeOutcome = Schema.decodeUnknownSync(
  Schema.Struct({
    list: Schema.Struct({
      result: Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) }),
    }),
    call: Schema.Struct({
      result: Schema.Struct({ content: Schema.Array(Schema.Struct({ text: Schema.String })) }),
    }),
  })
);

const sent = (received: ReadonlyArray<Received>, method: string) =>
  received.find((message) => message.method === method)?.params;

const firstTurn = async (session: HarnessSession) => {
  const collected = collect(session);
  await Effect.runPromise(
    session.sendTurn({
      turnId: TurnId.make("t-1"),
      prompt: "Do the assignment",
      attachments: [],
      model: null,
      effort: null,
    })
  );
  await collected.waitFor("TurnEnded");
};

test("a worker's session/new carries its MCP URL; the agent lists the tools and progress reaches the Constellation", async () => {
  const mcp = await endpoint();
  const attachment = await mcp.attach(workerBinding);

  const { fake, session } = await open(
    {
      initialize: httpMcp,
      prompts: [{ steps: [{ mcp: { tool: "progress", arguments: { note: "Checks passed" } } }] }],
    },
    attachment
  );

  await firstTurn(await session);

  expect(sent(fake.received(), "session/new")?.mcpServers).toEqual([
    { type: "http", name: "polaris", url: attachment.url, headers: [] },
  ]);
  expect(sent(fake.received(), "session/prompt")?.prompt).toEqual([
    { type: "text", text: polarisInstructions({ constellations: [attachment] }) },
    { type: "text", text: "Do the assignment" },
  ]);

  const outcome = decodeOutcome(sent(fake.received(), "fake/mcp"));
  expect(outcome.list.result.tools.map((tool) => tool.name)).toEqual(WORKER_TOOL_NAMES);
  expect(outcome.call.result.content[0]?.text).toStartWith("Progress recorded.");
  expect(mcp.calls).toHaveLength(1);
  expect(mcp.calls[0]?.command).toMatchObject({
    constellationId: workerBinding.constellationId,
    attemptId: workerBinding.attemptId,
  });
});

test("a resumed worker gets its MCP server again", async () => {
  const mcp = await endpoint();
  const attachment = await mcp.attach(workerBinding);
  const { fake, session } = await open({ initialize: httpMcp }, attachment, "earlier");

  await session;

  expect(sent(fake.received(), "session/resume")).toMatchObject({
    sessionId: "earlier",
    mcpServers: [{ type: "http", name: "polaris", url: attachment.url, headers: [] }],
  });
});

test("without HTTP MCP a worker refuses to open, and a plain session opens without tools", async () => {
  const mcp = await endpoint();
  const worker = await open({}, await mcp.attach(workerBinding));

  expect(
    (
      await worker.session.then(
        () => null,
        (e: Error) => e
      )
    )?.message
  ).toContain("doesn't accept HTTP MCP servers");

  const plain = await mcp.attach(
    McpBinding.cases.Plain.make({
      sessionId: workerBinding.sessionId,
      constellationId: ConstellationId.make("plain"),
      workspaceId: WorkspaceId.make("w"),
    })
  );

  const { fake, session } = await open({}, plain);
  await firstTurn(await session);

  expect(sent(fake.received(), "session/new")?.mcpServers).toEqual([]);
  expect(sent(fake.received(), "session/prompt")?.prompt).toEqual([
    { type: "text", text: polarisContextWithoutTools() },
    { type: "text", text: "Do the assignment" },
  ]);
});
