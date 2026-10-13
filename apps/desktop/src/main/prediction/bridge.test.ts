import { afterEach, expect, test } from "bun:test";
import type { HostConnection, LiveSession } from "@polaris/client";
import { Effect, Exit, Layer, ManagedRuntime, Stream, SubscriptionRef } from "effect";
import * as P from "@polaris/protocol";
import { HostDirectory, type ClientRuntime } from "../hosts.ts";
import type { Settings } from "../settings.ts";
import { PredictionSettings } from "./preferences.ts";
import { MainPredictionPlacement } from "./placement.ts";
import { LocalPredictor } from "./localPredictor.ts";
import { createPredictionBridge } from "./bridge.ts";
import { PredictionCompletionInput } from "../../shared/predictionContract.ts";
import type { HostView } from "../../shared/api.ts";

const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
});

const input = PredictionCompletionInput.make({
  hostKey: "pi",
  workspaceId: P.WorkspaceId.make("workspace"),
  path: "/workspace/main.ts",
  buffer: "return ",
  cursor: 7,
  recentEdits: [],
  budgetTokens: 2048,
});

const setup = async (
  options: {
    readonly localLayer?: Layer.Layer<LocalPredictor>;
    readonly hostStrong?: boolean;
    readonly enabled?: boolean;
    readonly url?: string;
  } = {}
) => {
  let settings: Settings = { predictionEnabled: options.enabled ?? true };

  const preferences = new PredictionSettings(
    () => settings,
    (value) => {
      settings = value;
    }
  );

  const endpoint = {
    kind: "openai",
    url: options.url ?? "http://127.0.0.1:8080",
    models: ["mellum2-12b-a2.5b"],
  } satisfies P.PredictionCapability["endpoints"][number];

  const client = P.PredictionCapability.make({
    machine: {
      chip: "Apple M2 Max",
      cpuCores: 12,
      ramBytes: 32 * 1024 ** 3,
      gpu: "Apple Silicon",
      gpuMemoryBytes: 32 * 1024 ** 3,
      unifiedMemory: true,
      load: 1,
    },
    endpoints: [endpoint],
  });

  const host = P.PredictionCapability.make({
    machine: options.hostStrong
      ? client.machine
      : {
          ...client.machine,
          chip: "Raspberry Pi 4",
          gpu: null,
          gpuMemoryBytes: null,
          ramBytes: 4 * 1024 ** 3,
          unifiedMemory: false,
        },
    endpoints: [endpoint],
  });

  const contextInputs: P.PredictionContextRequest[] = [];
  const requests: P.PredictionRequest[] = [];

  const methods = {
    "prediction.context": (request: P.PredictionContextRequest) =>
      Effect.sync(() => {
        contextInputs.push(request);

        return [
          P.PredictionContextPiece.make({
            kind: "definition",
            text: "const value = 42",
            source: "/workspace/value.ts",
          }),
        ];
      }),
    "prediction.capability": () => Effect.succeed(host),
    "prediction.complete": (request: P.PredictionRequest) => {
      requests.push(request);

      return Stream.make(P.PredictionStreamItem.cases.Final.make({ text: "host", elapsedMs: 8 }));
    },
  };

  const session: Partial<LiveSession> = {
    capabilities: [...P.PREDICTION_CAPABILITIES],
    // SAFETY: this fixture is consumed only through its three implemented prediction RPC methods.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- RPC discard/queue generics are unused by this partial fixture.
    client: methods as unknown as LiveSession["client"],
  };
  // SAFETY: only connection.session is read by this bridge; no Connection lifecycle is simulated here.

  const connection: Partial<HostConnection> = { session: Effect.succeed(session as LiveSession) };
  const views = await Effect.runPromise(SubscriptionRef.make<ReadonlyArray<HostView>>([]));

  const directory = HostDirectory.of({
    views,
    entry: () => undefined,
    // SAFETY: the bridge reads only session from this partial test connection.
    connection: () => Effect.succeed(connection as HostConnection),
    add: () => Effect.void,
    remove: () => Effect.void,
  });

  const runtime = ManagedRuntime.make(Layer.succeed(HostDirectory, directory));

  const placement = new MainPredictionPlacement({
    preferences,
    client: async () => client,
    host: async () => host,
  });
  // SAFETY: createPredictionBridge runs only HostDirectory effects on this test runtime.

  const bridge = createPredictionBridge({
    runtime: runtime as ClientRuntime,
    placement,
    preferences,
    read: () => settings,
    commit: (value) => {
      settings = value;
    },
    probe: { get: async () => client },
    localLayer: options.localLayer ?? LocalPredictor.layer,
  });

  cleanup.push(async () => {
    await bridge.dispose();
    await runtime.dispose();
  });

  return { bridge, preferences, contextInputs, requests, settings: () => settings };
};

test("IPC completion serves through the real predictor against a fake endpoint, with Host context and Final processing", async () => {
  const received: unknown[] = [];

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      received.push(await request.json());

      return new Response('data: {"choices":[{"text":"42"}]}\n\ndata: [DONE]\n\n', {
        headers: { "Content-Type": "text/event-stream" },
      });
    },
  });

  cleanup.push(async () => {
    await server.stop(true);
  });
  const { bridge, contextInputs } = await setup({ url: server.url.href });
  const items = await Effect.runPromise(Stream.runCollect(bridge.complete(input)));
  expect(contextInputs).toHaveLength(1);
  expect(contextInputs[0]?.buffer).toBe(input.buffer);
  expect(received).toHaveLength(1);
  expect(items.at(-1)).toMatchObject({ text: "42", model: "mellum2-12b-a2.5b" });
});

test("completion stays off until explicitly configured; discovery is acknowledged only when the action was shown", async () => {
  const { bridge, settings } = await setup({ enabled: false });
  expect(bridge.enabled()).toEqual({ enabled: false, configured: false });
  expect((await bridge.inspect("pi")).offer).toBe(true);
  expect(settings().predictionDiscoveryShown).toBeUndefined();
  bridge.discoveryShown();
  expect((await bridge.inspect("pi")).offer).toBe(false);
  expect(
    Exit.isFailure(await Effect.runPromiseExit(Stream.runCollect(bridge.complete(input))))
  ).toBe(true);
  bridge.setEnabled(true);
  expect(bridge.enabled()).toEqual({ enabled: true, configured: true });
});

test("the Host override delegates to TPLACE and consumes the negotiated Host stream", async () => {
  const { bridge, preferences, requests } = await setup({ hostStrong: true });
  preferences.set("pi", { ...preferences.get("pi"), placement: "host" });
  const items = await Effect.runPromise(Stream.runCollect(bridge.complete(input)));
  expect(requests).toHaveLength(1);
  expect(requests[0]?.context[0]?.kind).toBe("definition");
  expect(items.at(-1)).toMatchObject({ text: "host", machine: "pi" });
});

test("closing the subscription aborts the combined signal and LocalPredictor consumption", async () => {
  let active: AbortSignal | null = null;

  const layer = Layer.succeed(
    LocalPredictor,
    LocalPredictor.of({
      p50: () => null,
      complete: (_request, options) => {
        active = options?.signal ?? null;

        return Stream.never;
      },
    })
  );

  const { bridge } = await setup({ localLayer: layer });
  const controller = new AbortController();

  const pending = Effect.runPromiseExit(Stream.runCollect(bridge.complete(input)), {
    signal: controller.signal,
  });

  for (let i = 0; i < 50 && active === null; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  expect(active).not.toBeNull();
  controller.abort();
  await pending;
  // SAFETY: the LocalPredictor callback stored the signal before the assertion above.
  expect((active as AbortSignal | null)?.aborted).toBe(true);
});
