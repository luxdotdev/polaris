import type { Predictor } from "@polaris/predict";
import { Context, Effect, Layer, Stream } from "effect";

/** Client main-process runner; placement owns request replacement and stream interruption. */
export class LocalPredictor extends Context.Service<LocalPredictor, Predictor>()(
  "polaris/desktop/LocalPredictor"
) {
  static readonly layer = Layer.sync(LocalPredictor, () => {
    let loaded: Predictor | undefined;

    const get = Effect.fn("LocalPredictor.load")(function* () {
      const module = yield* Effect.promise(() => import("@polaris/predict"));
      loaded ??= module.createPredictor();

      return loaded;
    });

    return LocalPredictor.of({
      complete: (request, options) =>
        Stream.unwrap(Effect.map(get(), (predictor) => predictor.complete(request, options))),
      p50: (endpoint) => loaded?.p50(endpoint) ?? null,
    });
  });
}
