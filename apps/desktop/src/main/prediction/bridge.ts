import { createEditBridge } from "./editBridge.ts";
import { hostname } from "node:os";
import { CapabilityProbe } from "@polaris/client/prediction/probe";
import type { PredictionTarget } from "@polaris/client/prediction";
import { countTokens } from "@polaris/predict";
import {
  PredictionError,
  PredictionRequest,
  PredictionFormat,
  PredictionStreamItem,
  type PredictionContext,
  type PredictionServerReport,
} from "@polaris/protocol";
import { Effect, ManagedRuntime, Predicate, Queue, Schema, Stream, type Layer } from "effect";
import { HostDirectory, LOCAL_HOST_KEY, type ClientRuntime } from "../hosts.ts";
import type { Settings } from "../settings.ts";
import {
  PredictionFeedItem,
  type PredictionCompletionInput,
  type PredictionContextSummary,
  type PredictionInspection,
  type PredictionUiInputs,
} from "../../shared/predictionContract.ts";
import type { IpcError } from "../../shared/api.ts";
import type { MainPredictionPlacement, RoundTrip } from "./placement.ts";
import type { PredictionSettings } from "./preferences.ts";
import { LocalPredictor } from "./localPredictor.ts";
import { createManagedBridge } from "./managed.ts";

export interface PredictionBridgePorts {
  readonly localLayer?: Layer.Layer<LocalPredictor>;
  readonly probe?: Pick<CapabilityProbe, "get">;
  readonly runtime: ClientRuntime;
  readonly placement: MainPredictionPlacement;
  readonly preferences: PredictionSettings;
  readonly read: () => Settings;
  readonly commit: (settings: Settings) => void;
}

type Final = typeof PredictionFeedItem.cases.Final.Type;

type PredictionServerInput = (typeof PredictionUiInputs)["prediction.server"]["Type"];

/** An older Daemon can't say which server it reaches, so it offers no recovery. */
const UNKNOWN_SERVER: PredictionServerReport = { kind: "unknown", actions: [], outcome: null };

const contextSummary = (context: PredictionContext): PredictionContextSummary => ({
  pieces: context.length,
  languageServer: context.filter(
    (piece) => piece.kind === "definition" || piece.kind === "diagnostic"
  ).length,
  tokens: context.reduce((sum, piece) => sum + countTokens(`${piece.source}\n${piece.text}\n`), 0),
});

/** One LocalPredictor Layer per main process, shared by all completion subscriptions. */
export const createPredictionBridge = (ports: PredictionBridgePorts) => {
  const local = ManagedRuntime.make(ports.localLayer ?? LocalPredictor.layer);
  const probe = ports.probe ?? new CapabilityProbe();

  const enabled = () => ({
    enabled: ports.read().predictionEnabled ?? false,
    configured: ports.read().predictionConfigured ?? false,
  });

  const setEnabled = (value: boolean) => {
    ports.placement.invalidateAll();
    ports.commit({ ...ports.read(), predictionEnabled: value, predictionConfigured: true });

    return enabled();
  };

  const hostSession = Effect.fn("prediction.hostSession")(function* (hostKey: string) {
    const directory = yield* HostDirectory;
    const connection = yield* directory.connection(hostKey);

    return yield* connection.session;
  });

  const labels = (hostKey: string) =>
    ports.runtime.runPromise(
      Effect.gen(function* () {
        const directory = yield* HostDirectory;
        // The local Host's own name ("This Mac"), never the network hostname.
        const clientLabel = directory.entry(LOCAL_HOST_KEY)?.label ?? hostname();

        return {
          clientLabel,
          hostLabel:
            directory.entry(hostKey)?.label ?? (hostKey === LOCAL_HOST_KEY ? clientLabel : hostKey),
        };
      })
    );

  const managed = createManagedBridge({
    runtime: ports.runtime,
    preferences: ports.preferences,
    hostSession,
  });

  const inspect = async (hostKey: string): Promise<PredictionInspection> => {
    const [names, client, host, managedSides] = await Promise.all([
      labels(hostKey),
      managed.clientCapability(probe),
      ports.runtime
        .runPromise(
          Effect.flatMap(hostSession(hostKey), (session) =>
            session.capabilities.includes("prediction.capability")
              ? session.client["prediction.capability"]({
                  endpoints: ports.preferences
                    .get(hostKey)
                    .hostEndpoints.map((endpoint) => endpoint.url),
                  modelsDir: ports.preferences.get(hostKey).modelsDir,
                  model: ports.preferences.get(hostKey).managedModel,
                })
              : Effect.succeed(null)
          )
        )
        .catch(() => null),
      managed.inspect(hostKey),
    ]);

    // A managed server is Polaris's own, so finding one never triggers the discovery offer.
    const found = [...client.endpoints, ...(host?.endpoints ?? [])].some(
      (endpoint) => endpoint.models.length > 0 && endpoint.managed !== true
    );

    const offer = found && !enabled().configured && !ports.read().predictionDiscoveryShown;

    return { ...names, client, host, offer, managed: managedSides };
  };

  const withLatency = (hostKey: string, result: Final): Final =>
    result.side === undefined || result.endpoint === undefined
      ? result
      : { ...result, latency: ports.placement.latency(hostKey, result.side, result.endpoint) };

  /** The model server behind an endpoint, asked on the side that owns it. */
  const server = async (input: PredictionServerInput): Promise<PredictionServerReport> => {
    const request = { endpoint: input.endpoint, model: input.model, action: input.action };

    if (input.side === "client") {
      const module = await import("@polaris/client/prediction/server");

      return module.runServerAction(request);
    }

    return ports.runtime.runPromise(
      Effect.flatMap(hostSession(input.hostKey), (session) =>
        session.capabilities.includes("prediction.server")
          ? session.client["prediction.server"](request)
          : Effect.succeed(UNKNOWN_SERVER)
      )
    );
  };

  const complete = (input: PredictionCompletionInput) =>
    Stream.callback<PredictionFeedItem, IpcError>(
      Effect.fn("prediction.bridge.complete")(function* (queue) {
        const started = performance.now();
        const timings: Record<string, number> = {};

        if (input.dispatchedAt !== undefined)
          timings.ipc = Math.max(0, performance.timeOrigin + started - input.dispatchedAt);

        const mark = (stage: string) => {
          timings[stage] = performance.now() - started;
        };

        const controller = new AbortController();
        yield* Effect.addFinalizer(() => Effect.sync(() => controller.abort()));

        const serve = async (target: PredictionTarget, signal: AbortSignal, trip: RoundTrip) => {
          delete timings.firstToken;
          delete timings.prompt;
          delete timings.final;
          mark("placement");
          Queue.offerUnsafe(queue, PredictionFeedItem.cases.Reset.make({}));

          if (input.cursor > input.buffer.length)
            throw new PredictionError({
              reason: "invalid-request",
              message: "Cursor is outside the buffer",
            });

          const session = await ports.runtime.runPromise(hostSession(input.hostKey), { signal });

          const context = session.capabilities.includes("prediction.context")
            ? await ports.runtime.runPromise(session.client["prediction.context"](input), {
                signal,
              })
            : [];

          mark("context");

          const summary = session.capabilities.includes("prediction.context")
            ? contextSummary(context)
            : null;

          const request = PredictionRequest.make({
            context,
            path: input.path,
            prefix: input.buffer.slice(0, input.cursor).split("\n").slice(-121).join("\n"),
            suffix: input.buffer.slice(input.cursor).split("\n").slice(0, 41).join("\n"),
            model: target.model,
            format: Schema.decodeUnknownSync(PredictionFormat)(target.format),
            endpoint: target.endpoint,
            budgetTokens: input.budgetTokens,
            maxTokens: 128,
            maxLines: 8,
          });

          const names = await labels(input.hostKey);
          const predictorStart = performance.now() - started;
          let final: typeof PredictionStreamItem.cases.Final.Type | null = null;

          const receive = (item: PredictionStreamItem) => {
            if (Predicate.isTagged(item, "Final")) {
              final = item;
              mark("final");
            } else {
              if (timings.firstToken === undefined) mark("firstToken");
              Queue.offerUnsafe(queue, PredictionFeedItem.cases.Delta.make({ text: item.text }));
            }
          };

          if (target.managed) {
            const launched = await managed.ensure(
              { side: target.side, hostKey: input.hostKey },
              signal
            );

            if (launched) trip.exclude();
            trip.restart();
          }

          if (target.side === "client") {
            await local.runPromise(
              LocalPredictor.use((predictor) =>
                predictor
                  .complete(request, {
                    signal,
                    onTiming: (stage, elapsed) => {
                      timings[stage] = predictorStart + elapsed;
                    },
                  })
                  .pipe(Stream.runForEach((item) => Effect.sync(() => receive(item))))
              ),
              { signal }
            );
          } else {
            if (!session.capabilities.includes("prediction.complete"))
              throw new PredictionError({
                reason: "unavailable",
                message: "Host cannot serve completion",
              });
            await ports.runtime.runPromise(
              session.client["prediction.complete"](request).pipe(
                Stream.runForEach((item) => Effect.sync(() => receive(item)))
              ),
              { signal }
            );
          }
          // SAFETY: receive runs synchronously for every consumed stream item before runPromise resolves.

          const result = final as typeof PredictionStreamItem.cases.Final.Type | null;

          if (result === null)
            throw new PredictionError({
              reason: "invalid-response",
              message: "Prediction ended without a final result",
            });

          return PredictionFeedItem.cases.Final.make({
            text: result.text,
            timings: { ...timings },
            elapsedMs: result.elapsedMs,
            model: target.model,
            machine: target.side === "client" ? names.clientLabel : names.hostLabel,
            side: target.side,
            endpoint: { kind: target.endpoint.kind, url: target.endpoint.url },
            context: summary,
          });
        };

        const run = Effect.tryPromise({
          try: async () => {
            if (!enabled().enabled) throw new Error("Tab completion is off");

            const result = await ports.placement.run(
              input.hostKey,
              input.workspaceId,
              serve,
              controller.signal
            );

            // Placement records this round trip after serve returns, so latency is read here.
            Queue.offerUnsafe(queue, withLatency(input.hostKey, result));
            Queue.endUnsafe(queue);
          },
          catch: (error): IpcError => ({ code: "PredictionUnavailable", message: String(error) }),
        });

        yield* Effect.forkScoped(run.pipe(Effect.catch((error) => Queue.fail(queue, error))));
      })
    );

  const edits = createEditBridge({
    ports,
    local,
    hostSession,
    labels,
    enabled,
    contextSummary,
    ensureManaged: managed.ensure,
  });

  return {
    ...edits,
    enabled,
    setEnabled,
    inspect,
    complete,
    server,
    managed: managed.status,
    watchManaged: managed.watch,
    discoveryShown: () => ports.commit({ ...ports.read(), predictionDiscoveryShown: true }),
    release: (hostKey: string, workspaceId: string) =>
      ports.placement.release(hostKey, workspaceId),
    dispose: () => {
      ports.placement.invalidateAll();

      return local.dispose();
    },
  };
};

export type PredictionBridge = ReturnType<typeof createPredictionBridge>;
