import { expect, test } from "bun:test";
import { livePrediction } from "./live.testing.ts";

test.skipIf(process.env.POLARIS_PREDICTION_LIVE !== "1")(
  "Mellum2 streams a live FIM completion",
  async () => {
    const result = await livePrediction(
      process.env.POLARIS_PREDICTION_URL ?? "http://127.0.0.1:8080",
      process.env.POLARIS_PREDICTION_MODEL ?? "mellum2-12b-a2.5b"
    );

    console.log(JSON.stringify(result));
    expect(result.results.every((run) => run.deltas > 0)).toBe(true);
    expect(result.p50Ms).toBeGreaterThan(0);
  },
  60000
);
