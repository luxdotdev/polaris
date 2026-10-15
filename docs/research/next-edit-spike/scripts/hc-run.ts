// hc-run.ts <variant> <dev|fresh> [tag]: one live Sweep request per case on private :8091.
import { endpointDeltas } from "../../../../packages/predict/src/endpoint.ts";
import { buildEditPrompt } from "../../../../packages/predict/src/edit/prompt.ts";
import { loadSet, rawDir, requestFor, variantOf, type Output } from "./hc-lib.ts";

const [name = "", set = "dev", tag = name] = process.argv.slice(2);
const variant = variantOf(name);
const file = new URL(`${tag}.${set}.json`, rawDir);
if (await Bun.file(file).exists()) throw new Error(`Refusing to overwrite ${file.pathname}`);
const rows: Output[] = [];
for (const c of await loadSet(set)) {
  const input = requestFor(c, 8091, variant.maxTokens ?? 512);
  const start = performance.now();
  let output = "";
  try {
    const built = buildEditPrompt(input, variant.options);
    if (variant.temperature !== undefined) {
      // Sampling experiment only: production decoding is greedy.
      const res = await fetch(`${input.endpoint.url}/v1/completions`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: input.model, prompt: built.prompt, stream: false, cache_prompt: true, temperature: variant.temperature, seed: 1, max_tokens: input.maxTokens, stop: built.stop }), signal: AbortSignal.timeout(120000) });
      const body = (await res.json()) as { choices: { text: string; finish_reason: string }[] };
      output = body.choices[0]!.text;
      if (body.choices[0]!.finish_reason === "length") throw new Error("Edit prediction exhausted its output budget");
    } else for await (const d of endpointDeltas(input, built, AbortSignal.timeout(120000), globalThis.fetch)) output += d;
    rows.push({ id: c.id, output, elapsedMs: performance.now() - start });
  } catch (error) {
    rows.push({ id: c.id, output, elapsedMs: performance.now() - start, error: String((error as Error).message ?? error) });
  }
  process.stderr.write(".");
}
await Bun.write(file, JSON.stringify(rows) + "\n");
console.error(`\nRecorded ${rows.length} outputs to ${file.pathname}`);
