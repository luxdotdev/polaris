import { Effect, Stream } from "effect";
import { ServerRpcs } from "../transport/rpcs.ts";

/** No predictor or endpoint work is loaded until the first completion request. */
export const PredictionRpcsLive = ServerRpcs.toLayerHandler("prediction.complete", (request) =>
  Stream.unwrap(
    Effect.map(
      Effect.promise(() => import("./complete.ts")),
      (module) => module.complete(request)
    )
  )
);
