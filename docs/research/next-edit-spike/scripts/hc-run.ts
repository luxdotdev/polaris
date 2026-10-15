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
    for await (const d of endpointDeltas(input, buildEditPrompt(input, variant.options), AbortSignal.timeout(120000), globalThis.fetch)) output += d;
    rows.push({ id: c.id, output, elapsedMs: performance.now() - start });
  } catch (error) {
    rows.push({ id: c.id, output, elapsedMs: performance.now() - start, error: String((error as Error).message ?? error) });
  }
  process.stderr.write(".");
}
await Bun.write(file, JSON.stringify(rows) + "\n");
console.error(`\nRecorded ${rows.length} outputs to ${file.pathname}`);
