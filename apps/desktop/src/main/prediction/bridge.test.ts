import { afterEach, expect, test } from "bun:test";
import type { HostConnection, LiveSession } from "@polaris/client";
import { Effect, Exit, Layer, ManagedRuntime, Schema, Stream, SubscriptionRef } from "effect";
import * as P from "@polaris/protocol";
import { LatencyRecorder } from "@polaris/predict";
import { HostDirectory, type ClientRuntime } from "../hosts.ts";
import type { Settings } from "../settings.ts";
import { PredictionSettings } from "./preferences.ts";
import { MainPredictionPlacement } from "./placement.ts";
import { LocalPredictor } from "./localPredictor.ts";
import { createPredictionBridge } from "./bridge.ts";
import {
  EditPredictionFeedItem,
  PredictionCompletionInput,
} from "../../shared/predictionContract.ts";
import type { BatchEntry, HostView } from "../../shared/api.ts";

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
    readonly models?: string[];
    readonly hostEdit?: boolean;
    readonly enabled?: boolean;
    readonly url?: string;
    /** The endpoint is Polaris's own server; the first start answers that it loaded the model. */
    readonly managed?: boolean;
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
    models: options.models ?? ["mellum2-12b-a2.5b"],
    managed: options.managed === true,
  } satisfies P.PredictionCapability["endpoints"][number];

  const managedActions: Array<P.ManagedServerAction | null> = [];

  const managedAnswer = (action: P.ManagedServerAction | null): P.ManagedServerAnswer => ({
    model: {
      id: "sweep-next-edit-1.5b",
      name: "Sweep Next-Edit 1.5B",
      sizeBytes: 1_537_269_856,
      serverBytes: 11_971_406,
      memoryBytes: 2_600_000_000,
    },
    modelsDir: "/models",
    freeBytes: null,
    endpoint: { kind: "openai", url: endpoint.url },
    phase: P.ManagedServerPhase.cases.Serving.make({}),
    memoryBytes: null,
    loadMs: 61_000,
    launched: action === "start" && managedActions.filter((a) => a === "start").length === 1,
  });

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
  const editRequests: P.EditPredictionRequest[] = [];

  const methods = {
    "prediction.edit": (request: P.EditPredictionRequest) => {
      editRequests.push(request);

      return Stream.make(
        P.EditPredictionItem.cases.Final.make({
          edits: [{ from: request.cursor, to: request.cursor, text: "host edit" }],
          cursor: request.cursor + 9,
          window: { from: 0, to: request.buffer.length },
          suppressed: [],
          elapsedMs: 8,
        })
      );
    },
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
    "prediction.managed": (request: P.ManagedServerRequest) =>
      Effect.sync(() => {
        managedActions.push(request.action);

        return managedAnswer(request.action);
      }),
    "prediction.complete": (request: P.PredictionRequest) => {
      requests.push(request);

      return Stream.make(P.PredictionStreamItem.cases.Final.make({ text: "host", elapsedMs: 8 }));
    },
  };

  const session: Partial<LiveSession> = {
    capabilities: P.PREDICTION_CAPABILITIES.filter(
      (capability) => options.hostEdit !== false || capability !== "prediction.edit"
    ),
    // SAFETY: this fixture is consumed only through its implemented prediction RPC methods.
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
    recorder: () => new LatencyRecorder(),
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

  return {
    bridge,
    preferences,
    contextInputs,
    requests,
    editRequests,
    managedActions,
    runtime,
    settings: () => settings,
  };
};

test("a request to Polaris's own server starts it first; one that waited for the load leaves no latency sample", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async () =>
      new Response('data: {"choices":[{"text":"42"}]}\n\ndata: [DONE]\n\n', {
        headers: { "Content-Type": "text/event-stream" },
      }),
  });

  cleanup.push(async () => {
    await server.stop(true);
  });
  const { bridge, managedActions } = await setup({ url: server.url.href, managed: true });
  const complete = () => Effect.runPromise(Stream.runCollect(bridge.complete(input)));

  const first = [...(await complete())].at(-1);
  expect(managedActions).toEqual(["start"]);
  expect(first).toMatchObject({ text: "42", latency: null });

  const second = [...(await complete())].at(-1);
  expect(managedActions).toEqual(["start", "start"]);
  expect(second).toMatchObject({ latency: { count: 1 } });
});

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
      predict: () => Stream.never,
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

const editInput = {
  ...input,
  focus: null,
  history: [{ path: input.path, line: 0, before: "return 0", after: "return " }],
  dispatchedAt: performance.timeOrigin + performance.now(),
};

const localEdits = (requests: P.EditPredictionRequest[] = []) =>
  Layer.succeed(
    LocalPredictor,
    LocalPredictor.of({
      p50: () => null,
      complete: () => Stream.never,
      predict: (request) => {
        requests.push(request);

        return Stream.make(
          P.EditPredictionItem.cases.Final.make({
            edits: [{ from: request.cursor, to: request.cursor, text: "local edit" }],
            cursor: request.cursor + 10,
            window: { from: 0, to: request.buffer.length },
            suppressed: [],
            elapsedMs: 5,
          })
        );
      },
    })
  );

test("renderer edit feed decodes input and returns Client Final with history, Host context, target and timings", async () => {
  const requests: P.EditPredictionRequest[] = [];

  const { bridge, runtime } = await setup({
    models: ["zeta-2.1", "sweep-next-edit"],
    localLayer: localEdits(requests),
  });

  expect(await bridge.target("pi", input.workspaceId)).toMatchObject({
    editAvailable: true,
    target: { model: "sweep-next-edit", format: "sweep-next-edit", side: "client" },
  });
  const { windowSubscriptions } = await import("../ipc/subscriptions.ts");
  const delivered = Promise.withResolvers<ReadonlyArray<BatchEntry>>();

  const subscriptions = windowSubscriptions({
    prediction: bridge,
    // SAFETY: this prediction subscription supplies its own runtimes and only reads HostDirectory.
    runtime: runtime as ClientRuntime,
    target: { isDestroyed: () => false, send: (_channel, entries) => delivered.resolve(entries) },
  });

  cleanup.push(async () => subscriptions.dispose());
  subscriptions.subscribe({
    id: 1,
    kind: "prediction.edit",
    input: JSON.parse(JSON.stringify(editInput)),
  });
  const batch = await delivered.promise;
  const items = Schema.decodeUnknownSync(Schema.Array(EditPredictionFeedItem))(batch[0]?.items);

  expect(batch[0]?.end).toBeNull();
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    edits: [{ from: 7, to: 7, text: "local edit" }],
    cursor: 17,
    model: "sweep-next-edit",
    format: "sweep-next-edit",
    side: "client",
    context: { languageServer: 1 },
  });

  for (const stage of ["ipc", "placement", "context", "final"])
    expect(items[0]?.timings[stage]).toBeGreaterThanOrEqual(0);

  expect(requests[0]).toMatchObject({
    buffer: input.buffer,
    history: editInput.history,
    focus: null,
    context: [{ kind: "definition" }],
  });
});

test("Host edit override consumes the negotiated edit RPC and keeps Final edits intact", async () => {
  const { bridge, preferences, editRequests } = await setup({
    models: ["sweep-next-edit"],
    hostStrong: true,
  });

  preferences.set("pi", { ...preferences.get("pi"), placement: "host" });
  const items = await Effect.runPromise(Stream.runCollect(bridge.edit(editInput)));
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    edits: [{ from: 7, to: 7, text: "host edit" }],
    cursor: 16,
    model: "sweep-next-edit",
    format: "sweep-next-edit",
    side: "host",
  });
  expect(editRequests[0]?.history).toEqual(editInput.history);
});

test("a failed Client edit request falls back to the Host without publishing a failed attempt", async () => {
  const layer = Layer.succeed(
    LocalPredictor,
    LocalPredictor.of({
      p50: () => null,
      complete: () => Stream.never,
      predict: () =>
        Stream.fail(new P.PredictionError({ reason: "endpoint-failed", message: "fixture" })),
    })
  );

  const { bridge } = await setup({
    models: ["sweep-next-edit"],
    hostStrong: true,
    localLayer: layer,
  });

  const items = await Effect.runPromise(Stream.runCollect(bridge.edit(editInput)));
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ side: "host", edits: [{ text: "host edit" }] });
});

test("FIM remains the target when no next-edit model is available, and Off exposes no target", async () => {
  const { bridge } = await setup();
  expect(await bridge.target("pi", input.workspaceId)).toMatchObject({
    editAvailable: false,
    target: { model: "mellum2-12b-a2.5b", format: "mellum-spm" },
  });
  bridge.setEnabled(false);
  expect(await bridge.target("pi", input.workspaceId)).toEqual({
    editAvailable: false,
    target: null,
  });
});

test("unsubscribe aborts the Client edit signal and does not fall back", async () => {
  const started = Promise.withResolvers<AbortSignal | undefined>();

  const layer = Layer.succeed(
    LocalPredictor,
    LocalPredictor.of({
      p50: () => null,
      complete: () => Stream.never,
      predict: (_request, options) => {
        started.resolve(options?.signal);

        return Stream.never;
      },
    })
  );

  const { bridge, editRequests } = await setup({
    models: ["zeta-2.1"],
    hostStrong: true,
    localLayer: layer,
  });

  const controller = new AbortController();

  const pending = Effect.runPromiseExit(Stream.runCollect(bridge.edit(editInput)), {
    signal: controller.signal,
  });

  const signal = await started.promise;
  controller.abort();
  await pending;
  expect(signal?.aborted).toBe(true);
  expect(editRequests).toEqual([]);
});

test.each([0, 2])(
  "edit bridge rejects %s Final items instead of exposing an invalid prediction",
  async (count) => {
    const layer = Layer.succeed(
      LocalPredictor,
      LocalPredictor.of({
        p50: () => null,
        complete: () => Stream.never,
        predict: () =>
          Stream.fromIterable(
            Array.from({ length: count }, () =>
              P.EditPredictionItem.cases.Final.make({
                edits: [],
                cursor: null,
                window: { from: 0, to: input.buffer.length },
                suppressed: [],
                elapsedMs: 0,
              })
            )
          ),
      })
    );

    const { bridge } = await setup({ models: ["zeta-2.1"], localLayer: layer });
    const result = await Effect.runPromiseExit(Stream.runCollect(bridge.edit(editInput)));
    expect(Exit.isFailure(result)).toBe(true);
  }
);
