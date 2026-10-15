import type { EditPredictor } from "@polaris/predict";
import { Effect, Layer, Stream } from "effect";
import { ServerRpcs } from "../transport/rpcs.ts";

/** No predictor or endpoint work is loaded until the first completion request. */
const completionHandlers = ServerRpcs.toLayerHandler("prediction.complete", (request) =>
  Stream.unwrap(
    Effect.map(
      Effect.promise(() => import("./complete.ts")),
      (module) => module.complete(request)
    )
  )
);

/** The loader is a boundary for tests; construction does not import or contact a predictor. */
export const editPredictionHandlers = (load: () => Promise<EditPredictor>) =>
  ServerRpcs.toLayerHandler("prediction.edit", (request) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const controller = new AbortController();
        yield* Effect.addFinalizer(() => Effect.sync(() => controller.abort()));
        const predictor = yield* Effect.promise(load);

        return predictor.predict(request, { signal: controller.signal });
      })
    ).pipe(Stream.scoped)
  );

export const PredictionRpcsLive = Layer.merge(
  completionHandlers,
  editPredictionHandlers(async () => (await import("./edit.ts")).predictor)
);
