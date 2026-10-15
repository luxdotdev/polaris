import { PredictionError } from "@polaris/protocol";
import { Stream } from "effect";
import type { PredictionFetch } from "../endpoint.ts";
import type { EditPredictor } from "../types.ts";

/** Placeholder until the predictor slice lands; every request fails as unavailable. */
export const createEditPredictor = (
  _fetcher: PredictionFetch = globalThis.fetch
): EditPredictor => ({
  predict: () =>
    Stream.fail(
      new PredictionError({ reason: "unavailable", message: "Edit prediction is not built yet" })
    ),
  p50: () => null,
});
