import { describe, expect, test } from "bun:test";
import { SessionId } from "@polaris/protocol";
import { Effect, Layer, Logger } from "effect";
import { CdpRelay } from "../../browser/cdpRelay.ts";
import { AgentBrowser, type InstalledAgentBrowser } from "../../install/agentBrowser/index.ts";
import { BrowserMcp } from "./index.ts";

const SESSION = SessionId.make("s1");

const URL = "ws://127.0.0.1:4100/browser/s1/s3cret-token";

const INSTALLED = { binary: "/opt/ab", config: "/cfg.json" };

const relay = (issue: CdpRelay["Service"]["issue"]) =>
  Layer.succeed(CdpRelay)(CdpRelay.of({ issue, revoke: () => Effect.void }));

const forSession = async (
  relayLayer: Layer.Layer<CdpRelay>,
  installed: InstalledAgentBrowser | null = INSTALLED
) => {
  const logs: string[] = [];
  const logger = Logger.make((entry) => logs.push(Logger.formatSimple.log(entry)));

  const server = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* BrowserMcp).forSession(SESSION);
    }).pipe(
      Effect.provide(
        BrowserMcp.layer.pipe(
          Layer.provide(Layer.mergeAll(relayLayer, AgentBrowser.layerAt(installed)))
        )
      ),
      Effect.provide(Logger.layer([logger]))
    )
  );

  return { server, logs };
};

describe("BrowserMcp", () => {
  test("the session's relay URL reaches agent-browser's env, never its argv", async () => {
    const { server } = await forSession(relay(() => Effect.succeed({ url: URL })));

    expect(server).toEqual({
      command: "/opt/ab",
      args: ["mcp", "--tools", "core"],
      env: {
        AGENT_BROWSER_CONFIG: "/cfg.json",
        AGENT_BROWSER_SESSION: "polaris-s1",
        AGENT_BROWSER_IDLE_TIMEOUT_MS: "600000",
      },
      cdpUrl: URL,
    });
  });

  test("the relay stub's defect leaves the session without Browser tools instead of failing it", async () => {
    const { server, logs } = await forSession(CdpRelay.layerStub);

    expect(server).toBeNull();
    expect(logs.join("\n")).toContain("session s1: no Browser tools");
  });

  test("a missing agent-browser leaves the session without Browser tools", async () => {
    const { server } = await forSession(
      relay(() => Effect.succeed({ url: URL })),
      null
    );

    expect(server).toBeNull();
  });

  test("a relay error naming its URL is logged without the token", async () => {
    const { logs } = await forSession(relay(() => Effect.die(new Error(`refused ${URL}`))));

    expect(logs.join("\n")).toContain("/browser/s1/<redacted>");
    expect(logs.join("\n")).not.toContain("s3cret-token");
  });
});
