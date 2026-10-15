import type { EditPredictor, Predictor } from "@polaris/predict";
import { Context, Effect, Layer, Stream } from "effect";

/** Client main-process runner; placement owns request replacement and stream interruption. */
export class LocalPredictor extends Context.Service<
  LocalPredictor,
  Predictor & Pick<EditPredictor, "predict">
>()("polaris/desktop/LocalPredictor") {
  static readonly layer = Layer.sync(LocalPredictor, () => {
    let loaded: Predictor | undefined;
    let edit: EditPredictor | undefined;

    const get = Effect.fn("LocalPredictor.load")(function* () {
      const module = yield* Effect.promise(() => import("@polaris/predict"));
      loaded ??= module.createPredictor();

      return loaded;
    });

    const getEdit = Effect.fn("LocalPredictor.loadEdit")(function* () {
      const module = yield* Effect.promise(() => import("@polaris/predict"));
      edit ??= module.createEditPredictor();

      return edit;
    });

    return LocalPredictor.of({
      predict: (request, options) =>
        Stream.unwrap(Effect.map(getEdit(), (predictor) => predictor.predict(request, options))),
      complete: (request, options) =>
        Stream.unwrap(Effect.map(get(), (predictor) => predictor.complete(request, options))),
      p50: (endpoint) => edit?.p50(endpoint) ?? loaded?.p50(endpoint) ?? null,
    });
  });
}
