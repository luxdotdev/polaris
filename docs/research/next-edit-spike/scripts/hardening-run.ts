// Opt-in acquisition only: records raw production endpoint deltas before applying guards.
import { Schema } from "effect";
import { EditPredictionRequest } from "../../../../packages/protocol/src/index.ts";
import { endpointDeltas } from "../../../../packages/predict/src/endpoint.ts";
import { buildEditPrompt } from "../../../../packages/predict/src/edit/prompt.ts";
import { request } from "../../../../packages/predict/src/edit/fixtures.testing.ts";

const split = process.argv[2];
const format = process.argv[3] === "zeta-2.1" ? "zeta-2.1" : "sweep-next-edit";
const prefix = format === "zeta-2.1" ? "hardening-zeta" : "hardening";
if (process.env.POLARIS_PREDICTION_LIVE !== "1" || !["dev", "test"].includes(split ?? ""))
  throw new Error("Set POLARIS_PREDICTION_LIVE=1 and pass dev or test");
const port = format === "zeta-2.1" ? "8092" : "8091";
const url = process.env.POLARIS_EDIT_URL ?? `http://127.0.0.1:${port}`;
if (new URL(url).hostname !== "127.0.0.1" || new URL(url).port !== port) throw new Error(`Hardening acquisition requires private :${port}`);
const root = new URL("../../../../packages/predict/src/edit/fixtures/", import.meta.url);
const Case = Schema.Struct({ id: Schema.String, split: Schema.String, path: Schema.String,
  buffer: Schema.String, cursor: Schema.Number, history: EditPredictionRequest.fields.history });
const cases = Schema.decodeUnknownSync(Schema.Array(Case))(await Bun.file(new URL("hardening-cases.json", root)).json());
const outputFile = new URL(`${prefix}-${split}.json`, root);
if (await Bun.file(outputFile).exists()) throw new Error("Refusing to overwrite recorded outputs");
if (process.env.POLARIS_EDIT_WARMUP === "1") {
  const warmup = await fetch(`${url}/v1/completions`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: format, prompt: "hello", max_tokens: 1, temperature: 0, stream: false }),
    signal: AbortSignal.timeout(600000),
  });
  if (!warmup.ok) throw new Error(`Warmup failed: ${warmup.status}`);
  await warmup.arrayBuffer();
  process.stderr.write("Non-evaluation warmup completed.\n");
}
const rows = [];
for (const fixture of cases.filter((c) => c.split === split)) {
  const input = EditPredictionRequest.make({ ...request, ...fixture, format,
    endpoint: { kind: "openai", url }, model: format, maxTokens: 512 });
  const start = performance.now();
  let output = "";
  for await (const delta of endpointDeltas(input, buildEditPrompt(input), AbortSignal.timeout(120000), globalThis.fetch)) output += delta;
  rows.push({ id: fixture.id, output, elapsedMs: performance.now() - start });
  process.stderr.write(`${fixture.id} `);
}
await Bun.write(outputFile, JSON.stringify(rows) + "\n");
console.log(`\nRecorded ${rows.length} ${split} outputs; review separately`);
