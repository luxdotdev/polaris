/** Verifies cache reuse with production request bodies against the existing shared llama-server. */
import { mkdirSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { Effect, Schema, Stream } from "effect";
import { createPredictor } from "@polaris/predict";
import { PredictionRequest } from "@polaris/protocol";
import { REPO_ROOT } from "../lib/electron.ts";

const Stats = Schema.Struct({
  cache_n: Schema.Number,
  prompt_n: Schema.Number,
  prompt_ms: Schema.Number,
  predicted_n: Schema.Number,
  predicted_ms: Schema.Number,
});

const Chunk = Schema.Struct({ timings: Schema.optional(Stats) });

const out = `${REPO_ROOT}/.dagr/evidence/tlat/cache`;

mkdirSync(out, { recursive: true });

const request = PredictionRequest.make({
  context: [
    {
      kind: "importOutline",
      source: "types.ts",
      text: Array.from({ length: 30 }, (_, index) => `export const entry${index} = ${index};`).join(
        "\n"
      ),
    },
  ],
  path: "sum.ts",
  prefix: "export function add(a: number, b: number) {\n  return ",
  suffix: "\n}\n",
  model: "mellum2-12b-a2.5b",
  format: "mellum-spm",
  endpoint: { kind: "openai", url: "http://127.0.0.1:8080" },
  budgetTokens: 2048,
  maxTokens: 128,
  maxLines: 8,
});

let capture = Promise.resolve("");

const bodies: string[] = [];

const predictor = createPredictor(async (url, init) => {
  bodies.push(Schema.decodeUnknownSync(Schema.String)(init.body));
  const response = await fetch(url, init);
  capture = response.clone().text();

  return response;
});

const rows = [];

for (let round = 0; round < 3; round++) {
  for (const key of ["", "a"]) {
    const timing: Record<string, number> = {};

    const items = await Effect.runPromise(
      predictor
        .complete(
          { ...request, prefix: request.prefix + key },
          {
            onTiming: (stage, elapsed) => {
              timing[stage] = elapsed;
            },
          }
        )
        .pipe(Stream.runCollect)
    );

    const raw = await capture;
    writeFileSync(`${out}/${round}-${key || "space"}.sse`, raw);

    const stats = raw
      .split("\n")
      .filter((line) => line.startsWith("data: {"))
      .map((line) => Schema.decodeUnknownSync(Schema.fromJsonString(Chunk))(line.slice(6)))
      .find((chunk) => chunk.timings)?.timings;

    if (!stats) throw new Error("Shared server omitted timings");

    if (key && stats.cache_n === 0)
      throw new Error("Next keystroke did not reuse the prompt cache");
    rows.push({ round, key, stats, timing, final: items.at(-1), load: loadavg() });
  }
}

writeFileSync(`${out}/requests.json`, "[" + bodies.join(",") + "]");

writeFileSync(`${out}/results.json`, JSON.stringify(rows, null, 2));

console.log(JSON.stringify(rows, null, 2));
