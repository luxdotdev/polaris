import type { LiveSession } from "@polaris/client";
import {
  EditPredictionRequest,
  EditPredictionItem,
  EditPredictionFormat,
  PredictionError,
  type PredictionContext,
} from "@polaris/protocol";
import { Effect, Queue, Schema, Stream, type ManagedRuntime } from "effect";
import {
  EditPredictionFeedItem,
  type EditPredictionInput,
  type PredictionContextSummary,
  type PredictionWorkspaceTarget,
} from "../../shared/predictionContract.ts";
import type { IpcError } from "../../shared/api.ts";
import type { ClientServices } from "../hosts.ts";
import type { PredictionBridgePorts } from "./bridge.ts";
import { LocalPredictor } from "./localPredictor.ts";

interface EditBridgePorts {
  readonly ports: PredictionBridgePorts;
  readonly local: ManagedRuntime.ManagedRuntime<LocalPredictor, never>;
  readonly hostSession: (hostKey: string) => Effect.Effect<LiveSession, unknown, ClientServices>;
  readonly labels: (hostKey: string) => Promise<{ clientLabel: string; hostLabel: string }>;
  readonly enabled: () => { enabled: boolean };
  readonly contextSummary: (context: PredictionContext) => PredictionContextSummary;
}

export const createEditBridge = ({
  ports,
  local,
  hostSession,
  labels,
  enabled,
  contextSummary,
}: EditBridgePorts) => {
  const target = async (
    hostKey: string,
    workspaceId: string
  ): Promise<PredictionWorkspaceTarget> => {
    if (!enabled().enabled) return { editAvailable: false, target: null };

    const state = await ports.placement.choose(
      hostKey,
      workspaceId,
      new AbortController().signal,
      "auto",
      true
    );

    const serving = state.context.serving;

    return {
      editAvailable:
        serving !== null && (serving.format === "zeta-2.1" || serving.format === "sweep-next-edit"),
      target:
        serving === null
          ? null
          : {
              side: serving.side,
              model: serving.model,
              format: serving.format,
              endpoint: { kind: serving.endpoint.kind, url: serving.endpoint.url },
            },
    };
  };

  const edit = (input: EditPredictionInput) =>
    Stream.callback<EditPredictionFeedItem, IpcError>(
      Effect.fn("prediction.bridge.edit")(function* (queue) {
        const controller = new AbortController();
        yield* Effect.addFinalizer(() => Effect.sync(() => controller.abort()));
        const started = performance.now();
        const timings: Record<string, number> = {};

        if (input.dispatchedAt !== undefined)
          timings.ipc = Math.max(0, performance.timeOrigin + started - input.dispatchedAt);

        const mark = (stage: string) => {
          timings[stage] = performance.now() - started;
        };

        const run = Effect.tryPromise({
          try: async () => {
            if (!enabled().enabled) throw new Error("Tab completion is off");

            if (
              input.cursor > input.buffer.length ||
              (input.focus !== null && input.focus > input.buffer.length)
            )
              throw new PredictionError({
                reason: "invalid-request",
                message: "Cursor or focus is outside the buffer",
              });

            const result = await ports.placement.run(
              input.hostKey,
              input.workspaceId,
              async (serving, signal) => {
                delete timings.prompt;
                delete timings.firstToken;
                delete timings.final;
                mark("placement");
                const format = Schema.decodeUnknownSync(EditPredictionFormat)(serving.format);

                const session = await ports.runtime.runPromise(hostSession(input.hostKey), {
                  signal,
                });

                const context = session.capabilities.includes("prediction.context")
                  ? await ports.runtime.runPromise(session.client["prediction.context"](input), {
                      signal,
                    })
                  : [];

                mark("context");

                const request = EditPredictionRequest.make({
                  context,
                  path: input.path,
                  buffer: input.buffer,
                  cursor: input.cursor,
                  focus: input.focus,
                  history: input.history,
                  model: serving.model,
                  format,
                  endpoint: serving.endpoint,
                  maxTokens: 2048,
                });

                const names = await labels(input.hostKey);
                const items: EditPredictionItem[] = [];

                const receive = Stream.runForEach((item: EditPredictionItem) =>
                  Effect.gen(function* () {
                    if (items.length > 0)
                      return yield* new PredictionError({
                        reason: "invalid-response",
                        message: "Edit prediction returned multiple Finals",
                      });

                    items.push(item);
                    mark("final");
                  })
                );

                const predictorStart = performance.now() - started;

                if (serving.side === "client") {
                  await local.runPromise(
                    LocalPredictor.use((predictor) =>
                      predictor
                        .predict(request, {
                          signal,
                          onTiming: (stage, elapsed) => {
                            timings[stage] = predictorStart + elapsed;
                          },
                        })
                        .pipe(receive)
                    ),
                    { signal }
                  );
                } else {
                  if (!session.capabilities.includes("prediction.edit"))
                    throw new PredictionError({
                      reason: "unavailable",
                      message: "Host cannot serve edit prediction",
                    });
                  await ports.runtime.runPromise(
                    session.client["prediction.edit"](request).pipe(receive),
                    { signal }
                  );
                }

                const final = items[0];

                if (items.length !== 1 || final === undefined)
                  throw new PredictionError({
                    reason: "invalid-response",
                    message: "Edit prediction must return exactly one Final",
                  });

                return EditPredictionFeedItem.cases.Final.make({
                  ...final,
                  model: serving.model,
                  format,
                  side: serving.side,
                  machine: serving.side === "client" ? names.clientLabel : names.hostLabel,
                  endpoint: { kind: serving.endpoint.kind, url: serving.endpoint.url },
                  timings: { ...timings },
                  context: session.capabilities.includes("prediction.context")
                    ? contextSummary(context)
                    : null,
                  latency: null,
                });
              },
              controller.signal,
              "edit"
            );

            Queue.offerUnsafe(
              queue,
              EditPredictionFeedItem.cases.Final.make({
                ...result,
                latency: ports.placement.latency(input.hostKey, result.side, result.endpoint),
              })
            );
            Queue.endUnsafe(queue);
          },
          catch: (error): IpcError => ({ code: "PredictionUnavailable", message: String(error) }),
        });

        yield* Effect.forkScoped(run.pipe(Effect.catch((error) => Queue.fail(queue, error))));
      })
    );

  return { edit, target };
};
