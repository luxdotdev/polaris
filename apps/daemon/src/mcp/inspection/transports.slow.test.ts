import { expect, test } from "bun:test";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Effect, Stream } from "effect";
import { newTempDir, removeTempDir } from "../../platform/tempDir.testing.ts";
import { developerMode, makeTestDeveloperMode } from "../../traces/self/testing.ts";
import { attachConstellation } from "../../harness/constellation/attachment.ts";
import { claudeConstellationOptions } from "../../harness/claude/constellation.ts";
import { McpTokens } from "../tokens.ts";
import { mcpHttp } from "../http.ts";
import { fakeCommands, workerBinding } from "../testing.ts";
import { DesktopInspection } from "./relay.ts";

for (const transport of ["http", "claude"] as const) {
  test(`${transport} refreshes the inspection catalog off/on/off and reads a live renderer reply`, async () => {
    const root = newTempDir("inspection-mcp-", { short: true });

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const mode = yield* makeTestDeveloperMode();
            yield* Effect.gen(function* () {
              const relay = yield* DesktopInspection;
              const requests = yield* relay.register(100);
              yield* requests.pipe(
                Stream.runForEach(({ requestId }) =>
                  relay.respond(100, requestId, {
                    capturedAt: 123,
                    windows: [
                      {
                        id: 1,
                        title: "Polaris",
                        focused: true,
                        bounds: { x: 0, y: 0, width: 800, height: 600 },
                        view: "tab selected=true: Traces",
                      },
                    ],
                  })
                ),
                Effect.forkChild
              );
              const commands = fakeCommands().commands;
              const { origin } = yield* mcpHttp(commands);
              const attachment = yield* attachConstellation(workerBinding, origin, commands);
              const server = claudeConstellationOptions([attachment]).mcpServers?.polaris;

              if (server === undefined || server.type !== "sdk") throw new Error("No SDK server");
              const client = new Client({ name: "inspection-test", version: "1" });
              yield* Effect.promise(async () => {
                try {
                  if (transport === "http") {
                    // SAFETY: the SDK transport contract differs only by sessionId's undefined under exactOptionalPropertyTypes.
                    const connection = new StreamableHTTPClientTransport(
                      new URL(attachment.url)
                    ) as Transport;

                    await client.connect(connection);
                  } else {
                    const [local, remote] = InMemoryTransport.createLinkedPair();

                    await server.instance.connect(remote);
                    await client.connect(local);
                  }

                  const names = async () =>
                    (await client.listTools()).tools.map((tool) => tool.name);

                  expect(await names()).not.toContain("desktop_view");
                  expect(await names()).toContain("sessions");
                  await Effect.runPromise(mode.set(developerMode({ stored: true })));
                  expect(await names()).toContain("desktop_view");
                  expect(await names()).toContain("daemon_logs");
                  const result = await client.callTool({ name: "desktop_view", arguments: {} });

                  expect(result.isError).not.toBe(true);
                  expect(JSON.stringify(result.content)).toContain("tab selected=true: Traces");
                  await Effect.runPromise(mode.set(developerMode()));
                  expect(await names()).not.toContain("desktop_view");
                  expect(await names()).not.toContain("daemon_logs");

                  if (transport === "claude") {
                    expect(
                      (await client.callTool({ name: "desktop_view", arguments: {} })).isError
                    ).toBe(true);
                  } else {
                    await Promise.resolve(
                      expect(
                        client.callTool({ name: "desktop_view", arguments: {} })
                      ).rejects.toThrow("no such tool")
                    );
                  }
                } finally {
                  await client.close();
                  await server.instance.close();
                }
              });
            }).pipe(Effect.provide(mode.layer));
          })
        ).pipe(
          Effect.provide(McpTokens.layer(join(root, "tokens.sqlite"))),
          Effect.provide(DesktopInspection.layer)
        )
      );
    } finally {
      removeTempDir(root);
    }
  });
}
