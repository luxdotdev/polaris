import { hostname } from "node:os";
import { CapabilityProbe } from "@polaris/client/prediction/probe";
import type { PredictionTarget } from "@polaris/client/prediction";
import { PredictionError, PredictionRequest, PredictionStreamItem } from "@polaris/protocol";
import { Effect, ManagedRuntime, Predicate, Queue, Stream, type Layer } from "effect";
import { HostDirectory, LOCAL_HOST_KEY, type ClientRuntime } from "../hosts.ts";
import type { Settings } from "../settings.ts";
import {
  PredictionFeedItem,
  type PredictionCompletionInput,
  type PredictionInspection,
} from "../../shared/predictionContract.ts";
import type { IpcError } from "../../shared/api.ts";
import type { MainPredictionPlacement } from "./placement.ts";
import type { PredictionSettings } from "./preferences.ts";
import { LocalPredictor } from "./localPredictor.ts";

export interface PredictionBridgePorts {
  readonly localLayer?: Layer.Layer<LocalPredictor>;
  readonly probe?: Pick<CapabilityProbe, "get">;
  readonly runtime: ClientRuntime;
  readonly placement: MainPredictionPlacement;
  readonly preferences: PredictionSettings;
  readonly read: () => Settings;
  readonly commit: (settings: Settings) => void;
}

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

  const inspect = async (hostKey: string): Promise<PredictionInspection> => {
    const [names, client, host] = await Promise.all([
      labels(hostKey),
      probe.get(
        ports.preferences.getClientEndpoints().map((endpoint) => ({ ...endpoint, models: [] }))
      ),
      ports.runtime
        .runPromise(
          Effect.flatMap(hostSession(hostKey), (session) =>
            session.capabilities.includes("prediction.capability")
              ? session.client["prediction.capability"]({
                  endpoints: ports.preferences
                    .get(hostKey)
                    .hostEndpoints.map((endpoint) => endpoint.url),
                })
              : Effect.succeed(null)
          )
        )
        .catch(() => null),
    ]);

    const found = [...client.endpoints, ...(host?.endpoints ?? [])].some(
      (endpoint) => endpoint.models.length > 0
    );

    const offer = found && !enabled().configured && !ports.read().predictionDiscoveryShown;

    return { ...names, client, host, offer };
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

        const serve = async (target: PredictionTarget, signal: AbortSignal) => {
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

          const request = PredictionRequest.make({
            context,
            path: input.path,
            prefix: input.buffer.slice(0, input.cursor).split("\n").slice(-121).join("\n"),
            suffix: input.buffer.slice(input.cursor).split("\n").slice(0, 41).join("\n"),
            model: target.model,
            format: target.format,
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

            Queue.offerUnsafe(queue, result);
            Queue.endUnsafe(queue);
          },
          catch: (error): IpcError => ({ code: "PredictionUnavailable", message: String(error) }),
        });

        yield* Effect.forkScoped(run.pipe(Effect.catch((error) => Queue.fail(queue, error))));
      })
    );

  return {
    enabled,
    setEnabled,
    inspect,
    complete,
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
